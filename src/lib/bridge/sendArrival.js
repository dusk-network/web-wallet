/**
 * A send to someone, said to whoever isn't looking once a block takes it, as
 * a transfer on the Bridge is: by its Sent screen while that's shown, and,
 * once it's left before then, from wherever the wallet is while it's open,
 * where they asked to be told, or the tab's title is the one way. Nothing is
 * said of it once another wallet opens, or none.
 */

import { noteSentOutcome } from "$lib/activity";
import { goto } from "$lib/navigation";
import { followTransaction } from "$lib/transactions";

import { followsWhileAway, transferEnded } from "./arrivalNotice";

/**
 * @typedef {{ hash: string, stillOpen: (value?: unknown) => unknown, what: string }} Send
 *   `what` what was sent and to whom, as "0.5 DUSK to Alice"; `stillOpen`
 *   the check of the wallet it was sent from, `walletStore.whileOpen()`'s,
 *   which throws once another opened
 */

/**
 * Whether the wallet a send came from is the one open still.
 *
 * @param {Send} send
 */
function isOpenStill({ stillOpen }) {
  try {
    stillOpen();

    return true;
  } catch {
    return false;
  }
}

/**
 * What follows a send handed over, while the wallet's open: none otherwise.
 *
 * @type {((send: Send) => void) | null}
 */
let takeOver = null;

/**
 * Says a send ended, to whoever isn't looking, while its wallet's open.
 *
 * @param {Send & { failed: boolean }} send
 */
export function tellSendEnd(send) {
  const { failed, hash, what } = send;
  const href = `/dashboard/transactions?tx=${hash}`;

  if (!isOpenStill(send)) {
    return;
  }

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
  if (followsWhileAway() && isOpenStill(send)) {
    takeOver?.(send);
  }
}

/**
 * Follows each send handed over until a block takes it, or this stops:
 * History and Home say what it's told of it.
 *
 * @returns {() => void} Stops
 */
export function followSends() {
  const stopping = new AbortController();
  const { signal } = stopping;

  /** @param {Send} send */
  const follow = (send) => {
    let isTold = false;

    /** @param {import("$lib/transactions/followTransaction").FinalTransaction} outcome */
    const tell = (outcome) => {
      if (signal.aborted) {
        return;
      }

      noteSentOutcome(send.hash, outcome).catch(() => {});

      if (!isTold) {
        isTold = true;
        tellSendEnd({ ...send, failed: Boolean(outcome.error) });
      }
    };

    followTransaction(send.hash, { onBlock: tell, signal }).then(
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
