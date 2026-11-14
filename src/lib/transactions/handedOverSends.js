/**
 * What the chain says of a send kept on this device that was handed to the
 * node before its page went ($lib/transactions/unsentSends): it went out,
 * or failed, only as its own transaction, found by its hash in a block,
 * says; until then it may have gone out, and the person checks before
 * sending it again. It's never said as not sent, as the node may have it,
 * or have had it; nor as sent by anything else, as its account's nonce
 * moving on, which another send does too. Each is looked up as the wallet
 * opens, and again while it's open, until it's found or the person is done
 * with it.
 */

import { get, writable } from "svelte/store";

import { networkStore } from "$lib/stores";
import { walletDataScope } from "$lib/wallets/dataNames";

import { FOLLOW_INTERVAL, FOLLOW_TIMEOUT } from "./followTransaction";
import { dropUnsent, unsentSends } from "./unsentSends";

/** How long the network gets to answer each time it's asked, in milliseconds. */
const ANSWER_WITHIN = 10_000;

/**
 * How often one not found in its first FOLLOW_TIMEOUT is looked up from
 * then on, in milliseconds: a minute.
 */
const LOOK_AGAIN_EVERY = 60_000;

/**
 * What the chain says of it: in which block its transaction is, and what
 * went wrong there, if anything.
 *
 * @typedef {{ blockHeight: bigint, error: string | null }} WentOut
 */

/**
 * What `promise` gives, unless `signal` aborts first.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} signal
 * @returns {Promise<T>}
 */
const unlessAborted = (promise, signal) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
    promise.then(resolve, reject);
  });

/**
 * Looks a send that was handed over up on the chain by its transaction's
 * hash: the block that took it, or null where the chain doesn't have it.
 * It rejects where the network doesn't answer before `signal` aborts.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @param {AbortSignal} signal
 * @returns {Promise<WentOut | null>}
 */
export async function lookUpHandedOver(send, signal) {
  const { hash } = /** @type {{ hash: string }} */ (send.handedOver);
  const network = await unlessAborted(networkStore.connect(), signal);
  const { tx } =
    (await unlessAborted(
      network.query(`tx(hash: "${hash}") { blockHeight err }`, { signal }),
      signal
    )) ?? {};

  return tx
    ? { blockHeight: BigInt(tx.blockHeight), error: tx.err || null }
    : null;
}

/**
 * Those not found on the chain yet, by their ID: "checking" until it first
 * answers, then "unconfirmed".
 *
 * @type {import("svelte/store").Writable<Map<string, "checking" | "unconfirmed">>}
 */
const states = writable(new Map());

/**
 * Whether each send handed over is still looked up for the first time, or
 * wasn't found on the chain, by its ID: one found is no longer kept.
 */
export const handedOverStates = { subscribe: states.subscribe };

/**
 * @param {string} id
 * @param {"checking" | "unconfirmed" | null} state
 */
function setState(id, state) {
  states.update((map) => {
    const next = new Map(map);

    if (state) {
      next.set(id, state);
    } else {
      next.delete(id);
    }

    return next;
  });
}

/**
 * The sends followed, by the wallet's opening and their ID: one is looked up
 * once each time the wallet opens.
 *
 * @type {Set<string>}
 */
const followed = new Set();

/** @param {number} milliseconds */
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Whether a send is kept still: not once the person is done with it, nor
 * once another tab found it on the chain.
 *
 * @param {string} id
 */
const isKept = (id) => get(unsentSends).some((send) => send.id === id);

/**
 * Looks a send that was handed over up on the chain, now and again while
 * the wallet it's kept for is open and it's kept: often at first, as a
 * block may take it any moment, then once a minute, never given up on.
 * Once its transaction is found, it's no longer kept, and `onWentOut` says
 * so.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @param {(wentOut: WentOut) => void} onWentOut
 */
export function followHandedOver(send, onWentOut) {
  const scope = walletDataScope();
  const key = `${scope.id}:${send.id}`;

  if (!send.handedOver || followed.has(key)) {
    return;
  }

  followed.add(key);
  setState(send.id, "checking");

  const often = Date.now() + FOLLOW_TIMEOUT;

  void (async () => {
    while (scope.isOpen() && isKept(send.id)) {
      const wentOut = await lookUpHandedOver(
        send,
        AbortSignal.timeout(ANSWER_WITHIN)
      ).catch(() => null);

      if (!scope.isOpen()) {
        break;
      }

      if (wentOut) {
        setState(send.id, null);
        dropUnsent(send.id);
        onWentOut(wentOut);

        return;
      }

      setState(send.id, "unconfirmed");
      await pause(Date.now() < often ? FOLLOW_INTERVAL : LOOK_AGAIN_EVERY);
    }

    // Another wallet opened, or none, or the person is done with it: one
    // kept still is looked up again as its wallet opens.
    setState(send.id, null);
  })();
}
