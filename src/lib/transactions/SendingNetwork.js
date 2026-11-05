import { Network } from "@dusk/w3sper";

import { outcomeUnknown } from "./outcomeUnknown";

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
    const { transactions } = this;
    const propagate = transactions.propagate.bind(transactions);

    transactions.propagate = (/** @type {any} */ tx) => {
      broadcasts.add(tx);

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
   * Builds, checks and broadcasts a transaction, as w3sper does.
   *
   * @template {import("@dusk/w3sper").BasicTransfer} T
   * @param {T} tx A transaction's builder
   * @returns {ReturnType<T["build"]>}
   */
  execute(tx) {
    /** @type {any} */
    let built = tx;

    // The transaction its builder makes, to know it by its bytes.
    const watched = new Proxy(tx, {
      get(target, property) {
        const value = Reflect.get(target, property);

        if (property === "build" && typeof value === "function") {
          return async (/** @type {unknown} */ network) =>
            (built = await value.call(target, network));
        }

        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    return /** @type {ReturnType<T["build"]>} */ (
      super.execute(watched).catch((/** @type {unknown} */ error) => {
        throw this.#broadcasts.has(built?.buffer)
          ? outcomeUnknown(error)
          : error;
      })
    );
  }
}
