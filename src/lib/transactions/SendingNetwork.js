import { Network } from "@dusk/w3sper";
import { writable } from "svelte/store";

import { outcomeUnknown } from "./outcomeUnknown";

/** How many transactions this tab asked a node to broadcast. */
const asked = writable(0);

/**
 * How many transactions this tab asked a node to broadcast: once one was, it
 * may have gone out, whatever the node answers.
 */
export const broadcastsAsked = { subscribe: asked.subscribe };

/** How long a socket given up on gets to close, in milliseconds. */
const ABANDON_TIMEOUT = 3000;

/**
 * The network as the wallet sends on it, which tells a send that failed
 * before its transaction was handed to the node from one that may have
 * gone out. Building it, proving it and the node's check of it (preverify)
 * come first, and a failure there sends nothing. Once the node was asked
 * to broadcast it (propagate), its answer may be what got lost: what the
 * send ran into from then on is marked (outcomeUnknown). It can also give up
 * on a connection that didn't come (abandon).
 */
export default class SendingNetwork extends Network {
  /**
   * The transactions the node was asked to broadcast, by their bytes.
   *
   * @type {WeakSet<object>}
   */
  #broadcasts = new WeakSet();

  /**
   * What each transaction does as the node is asked to broadcast it, by its
   * bytes: its gate lets it go on, and none goes that was called off before
   * (sendGate), and whoever asked is told it may go out from then on.
   *
   * @type {WeakMap<object, () => void>}
   */
  #handOvers = new WeakMap();

  /**
   * The socket of the last attempt to connect: w3sper keeps its own to itself.
   *
   * @type {WebSocket | null}
   */
  #socket = null;

  /**
   * @param {URL} url
   * @param {object} [options]
   */
  constructor(url, options = {}) {
    super(url, options);

    const broadcasts = this.#broadcasts;
    const handOvers = this.#handOvers;
    const { transactions } = this;
    const propagate = transactions.propagate.bind(transactions);

    transactions.propagate = (/** @type {any} */ tx) => {
      // Called off before this, it never reaches the node.
      handOvers.get(tx)?.();
      broadcasts.add(tx);
      asked.update((count) => count + 1);

      return propagate(tx);
    };
  }

  /**
   * Connects, as w3sper does, keeping a hand on the socket it makes.
   *
   * @param {Parameters<Network["connect"]>} args
   */
  connect(...args) {
    const { WebSocket: Socket } = globalThis;

    globalThis.WebSocket = new Proxy(Socket, {
      construct: (Target, socketArgs) =>
        (this.#socket = new Target(.../** @type {[string]} */ (socketArgs))),
    });

    try {
      return super.connect(...args);
    } finally {
      globalThis.WebSocket = Socket;
    }
  }

  /**
   * Gives up on a connection that didn't come. w3sper can close only an open
   * socket, and any attempt after this one waits for the socket still
   * connecting, for as long as the browser does, however well the node is by
   * then. It's over once the socket is, or else soon: one open that never said
   * its session may take a while to agree.
   *
   * @returns {Promise<void>}
   */
  abandon() {
    const socket = this.#socket;

    if (!socket || socket.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      socket.addEventListener("close", () => resolve(), { once: true });
      setTimeout(resolve, ABANDON_TIMEOUT);
      socket.close();
    });
  }

  /**
   * Builds, checks and broadcasts a transaction, as w3sper does: with a
   * `gate`, only while it isn't called off, which it checks once it's built,
   * and as the node is asked to broadcast it. As it is, `onHandOver` is told
   * its hash, whatever the node answers, or if no answer comes.
   *
   * @template {import("@dusk/w3sper").BasicTransfer} T
   * @param {T} tx A transaction's builder
   * @param {{ gate?: import("./sendGate").SendGate, onHandOver?: (hash: string) => void }} [options]
   * @returns {ReturnType<T["build"]>}
   */
  execute(tx, { gate, onHandOver } = {}) {
    /** @type {any} */
    let built = tx;
    const handOvers = this.#handOvers;

    // The transaction its builder makes, to know it by its bytes.
    const watched = new Proxy(tx, {
      get(target, property) {
        const value = Reflect.get(target, property);

        if (property === "build" && typeof value === "function") {
          return async (/** @type {unknown} */ network) => {
            const made = await value.call(target, network);

            built = made;
            gate?.check();
            handOvers.set(made.buffer, () => {
              gate?.handOver();

              // Whoever's told can't stop it going out.
              try {
                onHandOver?.(String(made.hash ?? ""));
              } catch {
                // Nothing to do: it goes out all the same.
              }
            });

            return made;
          };
        }

        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    // Once the node was asked to broadcast it, it may have gone out, with the
    // hash it was built with, which follows it.
    return /** @type {ReturnType<T["build"]>} */ (
      super.execute(watched).catch((/** @type {unknown} */ error) => {
        throw this.#broadcasts.has(built?.buffer)
          ? outcomeUnknown(error, String(built.hash ?? ""))
          : error;
      })
    );
  }
}
