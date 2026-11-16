/**
 * A send the person can still call off, until the node is asked to
 * broadcast it: from then on it may have gone out, whatever follows. Calling
 * it off and handing it over can't both happen: whichever comes first wins,
 * as the one thread runs them. A send called off stops at once, before
 * anything it waits on answers, and never reaches the node. Until then, what
 * couldn't reach the network waits for it, as on a network that doesn't
 * answer, and is made again once it answers (`untilHandedOver`). One that
 * waited can be held until the person says to send it all the same (`ask`),
 * as its account sent something else meanwhile. From the moment the node is
 * asked to check it, it goes out (`goingOut`): it's no longer offered to call
 * off, though it's handed over only once the node passed it.
 */

import { writable } from "svelte/store";

import { isUnreachable } from "./describeFailure";

/** A send called off before the node was asked to broadcast it. */
export class SendCancelledError extends Error {
  constructor() {
    super("The send was cancelled before it went out.");
    this.name = "SendCancelledError";
  }
}

/**
 * How long a send that couldn't reach the network waits before it asks the
 * network again, where the browser doesn't say first that it's back online,
 * in milliseconds.
 */
export const ASK_AGAIN_AFTER = 5000;

/** How long the network gets to answer each time it's asked, in milliseconds. */
const ANSWER_WITHIN = 10_000;

/**
 * Where a send is: "open" until it's handed over or called off.
 *
 * @typedef {"cancelled" | "handed-over" | "open"} SendGateState
 */

/**
 * The transaction handed over: its hash, and its nonce, "" for one that has
 * none, as a shielded transfer.
 *
 * @typedef {{ hash: string, nonce: string }} HandedOver
 */

/**
 * @typedef {{
 *   ask: () => Promise<void>,
 *   asking: import("svelte/store").Readable<boolean>,
 *   cancel: (reason?: Error) => boolean,
 *   cancelled: Promise<never>,
 *   check: () => void,
 *   checking: () => void,
 *   goingOut: import("svelte/store").Readable<boolean>,
 *   handOver: (sent?: HandedOver) => Promise<void>,
 *   keepFirst: (keep: (sent: HandedOver) => Promise<void>) => void,
 *   sendToo: () => boolean,
 *   subscribe: import("svelte/store").Readable<SendGateState>["subscribe"],
 *   untilHandedOver: <T>(attempt: (waited: boolean) => Promise<T>, answers: (signal: AbortSignal) => Promise<unknown>) => Promise<T>,
 *   waitsForNetwork: import("svelte/store").Readable<boolean>,
 * }} SendGate
 *   `cancel` calls it off, where it wasn't handed over, by the person or
 *   for `reason`, as a lock: whether it did; `cancelled` rejects with why
 *   as it's called off; `check` throws it once it is, for the steps before
 *   the broadcast; `handOver` passes it on to the node, and throws it
 *   instead where it was called off: it's done once what's kept of it says
 *   so (`keepFirst`), and only then may the node be asked to broadcast it,
 *   never where it rejects; `untilHandedOver` makes what comes before that
 *   again while it couldn't reach the network, once the network answers what
 *   `answers` asks, telling `attempt` whether it waited; `waitsForNetwork`
 *   says whether it waits for that, until it's handed over or called off;
 *   `ask` holds it until the person says to send it all the same
 *   (`sendToo`, true where it was held), and rejects with why as it's
 *   called off meanwhile; `asking` says whether it's held so; `checking`
 *   says the node is asked to check it, and `goingOut` whether it was and
 *   it doesn't wait for the network again since.
 */

/** @returns {SendGate} */
export function sendGate() {
  const state = writable(/** @type {SendGateState} */ ("open"));
  const waiting = writable(false);
  const held = writable(false);
  const out = writable(false);
  let now = /** @type {SendGateState} */ ("open");

  /**
   * Lets a send held for the person go on (`ask`): null while none is.
   *
   * @type {(() => void) | null}
   */
  let goOn = null;

  /** Why it was called off. */
  let why = /** @type {Error} */ (new SendCancelledError());

  /**
   * What keeps it as handed over before the node is asked to broadcast it.
   *
   * @type {Array<(sent: HandedOver) => Promise<void>>}
   */
  const keepers = [];

  /** Stops what it waits on before it asks the network again. */
  const stopWaiting = new AbortController();

  /** @type {(error: Error) => void} */
  let stop = () => {};

  /** @type {Promise<never>} */
  const cancelled = new Promise((_, reject) => {
    stop = reject;
  });

  // Nothing need wait on it.
  cancelled.catch(() => {});

  /** @param {SendGateState} next */
  const set = (next) => {
    now = next;
    goOn = null;
    state.set(next);
    waiting.set(false);
    held.set(false);
  };

  const check = () => {
    if (now === "cancelled") {
      throw why;
    }
  };

  /**
   * A pause before the network is asked again: over as the browser says
   * it's back online, or as the send is called off.
   *
   * @returns {Promise<void>}
   */
  const pause = () =>
    new Promise((resolve) => {
      const end = () => {
        clearTimeout(timer);
        globalThis.removeEventListener("online", end);
        stopWaiting.signal.removeEventListener("abort", end);
        resolve();
      };
      const timer = setTimeout(end, ASK_AGAIN_AFTER);

      globalThis.addEventListener("online", end);
      stopWaiting.signal.addEventListener("abort", end);
    });

  /**
   * Waits until the network answers, asked after each pause; called off, it
   * stops at once, with why.
   *
   * @param {(signal: AbortSignal) => Promise<unknown>} answers
   */
  async function networkAnswers(answers) {
    for (;;) {
      await pause();
      check();

      const answered = await answers(
        AbortSignal.any([
          AbortSignal.timeout(ANSWER_WITHIN),
          stopWaiting.signal,
        ])
      ).then(
        () => true,
        () => false
      );

      check();

      if (answered) {
        return;
      }
    }
  }

  return {
    async ask() {
      check();

      const answered = Promise.withResolvers();

      goOn = () => answered.resolve(undefined);
      held.set(true);
      // Called off meanwhile, it stops at once, with why.
      await Promise.race([answered.promise, cancelled]);
    },
    asking: { subscribe: held.subscribe },
    cancel(reason = new SendCancelledError()) {
      if (now !== "open") {
        return false;
      }

      why = reason;
      set("cancelled");
      stopWaiting.abort();
      stop(reason);

      return true;
    },
    cancelled,
    check,
    checking() {
      if (now === "open") {
        out.set(true);
      }
    },
    goingOut: { subscribe: out.subscribe },
    handOver(sent = { hash: "", nonce: "" }) {
      check();
      set("handed-over");

      return Promise.all(keepers.map((keep) => keep(sent))).then(() => {});
    },
    keepFirst(keep) {
      keepers.push(keep);
    },
    sendToo() {
      const release = goOn;

      if (now !== "open" || !release) {
        return false;
      }

      goOn = null;
      held.set(false);
      release();

      return true;
    },
    subscribe: state.subscribe,
    async untilHandedOver(attempt, answers) {
      for (let waited = false; ; waited = true) {
        try {
          return await attempt(waited);
        } catch (error) {
          // Once handed over it may have gone out, and is never made again.
          if (now !== "open" || !isUnreachable(error)) {
            throw error;
          }
        }

        // Not out: it waits for the network again.
        out.set(false);
        waiting.set(true);
        await networkAnswers(answers);
        // It answers: the send is being made again, no longer waiting.
        waiting.set(false);
      }
    },
    waitsForNetwork: { subscribe: waiting.subscribe },
  };
}
