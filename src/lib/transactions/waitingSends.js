/**
 * The sends that haven't gone out yet, wherever the wallet is: each from when
 * it's sent until the node is asked to broadcast it, it's called off, or it
 * ends. Home says each waits, with Cancel (sendGate).
 */

import { writable } from "svelte/store";

/**
 * A send waiting to go out: what it sends and to whom, as "0.01 DUSK to
 * Profile 2", and what calls it off, while it can be.
 *
 * @typedef {{ cancel: (reason?: Error) => boolean, id: string, what: string }} WaitingSend
 */

/** @type {import("svelte/store").Writable<WaitingSend[]>} */
const sends = writable([]);

/** The sends waiting to go out, the oldest first. */
export const waitingSends = { subscribe: sends.subscribe };

/**
 * Says a send waits to go out, until it does, is called off or ends.
 *
 * @param {{ gate: import("./sendGate").SendGate, operation: Promise<unknown>, what: string }} send
 */
export function keepWaiting({ gate, operation, what }) {
  /** @type {WaitingSend} */
  const entry = {
    cancel: (/** @type {Error | undefined} */ reason) => gate.cancel(reason),
    id: crypto.randomUUID(),
    what,
  };
  let isWaiting = true;

  /** @type {() => void} */
  let stopFollowing = () => {};

  const done = () => {
    if (isWaiting) {
      isWaiting = false;
      sends.update((list) => list.filter((each) => each !== entry));
      stopFollowing();
    }
  };

  sends.update((list) => [...list, entry]);
  stopFollowing = gate.subscribe((state) => {
    if (state !== "open") {
      done();
    }
  });

  // Gone out or called off already as it was followed.
  if (!isWaiting) {
    stopFollowing();
  }

  operation.then(done, done);
}

/**
 * Calls off every send that hasn't gone out, as the wallet locks or another
 * opens, for `reason`: a send goes out only while the wallet it began on is
 * open.
 *
 * @param {Error} [reason]
 */
export function cancelWaitingSends(reason) {
  let waiting = /** @type {WaitingSend[]} */ ([]);

  sends.update((list) => {
    waiting = list;

    return [];
  });

  for (const send of waiting) {
    send.cancel(reason);
  }
}
