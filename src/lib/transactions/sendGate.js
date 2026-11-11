/**
 * A send the person can still call off, until the node is asked to
 * broadcast it: from then on it may have gone out, whatever follows. Calling
 * it off and handing it over can't both happen: whichever comes first wins,
 * as the one thread runs them. A send called off stops at once, before
 * anything it waits on answers, and never reaches the node.
 */

import { writable } from "svelte/store";

/** A send called off before the node was asked to broadcast it. */
export class SendCancelledError extends Error {
  constructor() {
    super("The send was cancelled before it went out.");
    this.name = "SendCancelledError";
  }
}

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
 * }} SendGate
 *   `cancel` calls it off, where it wasn't handed over, by the person or
 *   for `reason`, as a lock: whether it did; `cancelled` rejects with why
 *   as it's called off; `check` throws it once it is, for the steps before
 *   the broadcast; `handOver` passes it on to the node, and throws it
 *   instead where it was called off.
 */

/** @returns {SendGate} */
export function sendGate() {
  const state = writable(/** @type {SendGateState} */ ("open"));
  let now = /** @type {SendGateState} */ ("open");

  /** Why it was called off. */
  let why = /** @type {Error} */ (new SendCancelledError());

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
  };

  return {
    cancel(reason = new SendCancelledError()) {
      if (now !== "open") {
        return false;
      }

      why = reason;
      set("cancelled");
      stop(reason);

      return true;
    },
    cancelled,
    check() {
      if (now === "cancelled") {
        throw why;
      }
    },
    handOver() {
      if (now === "cancelled") {
        throw why;
      }

      set("handed-over");
    },
    subscribe: state.subscribe,
  };
}
