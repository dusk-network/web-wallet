/**
 * A send the person can still call off, until the node is asked to
 * broadcast it: from then on it may have gone out, whatever follows. Calling
 * it off and handing it over can't both happen: whichever comes first wins,
 * as the one thread runs them. A send called off stops at once, before
 * anything it waits on answers, and never reaches the node. Until then, what
 * couldn't reach the network waits for it, as on a network that doesn't
 * answer, and is made again once it answers (`untilHandedOver`).
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
 * @typedef {{
 *   cancel: (reason?: Error) => boolean,
 *   cancelled: Promise<never>,
 *   check: () => void,
 *   handOver: () => void,
 *   subscribe: import("svelte/store").Readable<SendGateState>["subscribe"],
 *   untilHandedOver: <T>(attempt: () => Promise<T>, answers: (signal: AbortSignal) => Promise<unknown>) => Promise<T>,
 *   waitsForNetwork: import("svelte/store").Readable<boolean>,
 * }} SendGate
 *   `cancel` calls it off, where it wasn't handed over, by the person or
 *   for `reason`, as a lock: whether it did; `cancelled` rejects with why
 *   as it's called off; `check` throws it once it is, for the steps before
 *   the broadcast; `handOver` passes it on to the node, and throws it
 *   instead where it was called off; `untilHandedOver` makes what comes
 *   before that again while it couldn't reach the network, once the network
 *   answers what `answers` asks; `waitsForNetwork` says whether it waits for
 *   that, until it's handed over or called off.
 */

/** @returns {SendGate} */
export function sendGate() {
  const state = writable(/** @type {SendGateState} */ ("open"));
  const waiting = writable(false);
  let now = /** @type {SendGateState} */ ("open");

  /** Why it was called off. */
  let why = /** @type {Error} */ (new SendCancelledError());

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
    state.set(next);
    waiting.set(false);
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
    handOver() {
      check();
      set("handed-over");
    },
    subscribe: state.subscribe,
    async untilHandedOver(attempt, answers) {
      for (;;) {
        try {
          return await attempt();
        } catch (error) {
          // Once handed over it may have gone out, and is never made again.
          if (now !== "open" || !isUnreachable(error)) {
            throw error;
          }
        }

        waiting.set(true);
        await networkAnswers(answers);
        // It answers: the send is being made again, no longer waiting.
        waiting.set(false);
      }
    },
    waitsForNetwork: { subscribe: waiting.subscribe },
  };
}
