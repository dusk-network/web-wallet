/**
 * A send to someone, said to whoever isn't looking once a block takes it, as
 * a transfer on the Bridge is: by its Sent screen while that's shown, and,
 * once it's left before then, from wherever the wallet is while it's open,
 * where they asked to be told, or the tab's title is the one way.
 */

import { goto } from "$lib/navigation";
import { followTransaction } from "$lib/transactions";

import { followsWhileAway, transferEnded } from "./arrivalNotice";

/**
 * @typedef {{ hash: string, what: string }} Send
 *   `what` what was sent and to whom, as "0.5 DUSK to Alice"
 */

/**
 * What follows a send handed over, while the wallet's open: none otherwise.
 *
 * @type {((send: Send) => void) | null}
 */
let takeOver = null;

/**
 * Says a send ended, to whoever isn't looking.
 *
 * @param {Send & { failed: boolean }} send
 */
export function tellSendEnd({ failed, hash, what }) {
  const href = `/dashboard/transactions?tx=${hash}`;

  transferEnded({
    href,
    id: `send:${hash}`,
    onOpen: () => goto(href),
    title: failed ? "It didn't go through" : `Arrived: ${what}`,
  });
}

/**
 * A send whose Sent screen is left before a block took it: the wallet
 * follows it on, where it's told of.
 *
 * @param {Send} send
 */
export function handOverSend(send) {
  if (followsWhileAway()) {
    takeOver?.(send);
  }
}

/**
 * Follows each send handed over until a block takes it, or this stops.
 *
 * @returns {() => void} Stops
 */
export function followSends() {
  const stopping = new AbortController();
  const { signal } = stopping;

  /** @param {Send} send */
  const follow = ({ hash, what }) => {
    let isTold = false;

    /** @param {{ error: string | null }} outcome */
    const tell = ({ error }) => {
      if (!isTold && !signal.aborted) {
        isTold = true;
        tellSendEnd({ failed: Boolean(error), hash, what });
      }
    };

    followTransaction(hash, { onBlock: tell, signal }).then(
      (final) => final && tell(final),
      () => {}
    );
  };

  takeOver = follow;

  return () => {
    stopping.abort();

    if (takeOver === follow) {
      takeOver = null;
    }
  };
}
