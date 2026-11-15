/**
 * What the chain says of a send kept on this device that was handed to the
 * node before its page went ($lib/transactions/unsentSends): it went out,
 * or failed, only as its own transaction, found by its hash in a block,
 * says; until then it may have gone out, and the person checks before
 * sending it again. It's said as not sent only once its account's
 * transaction with its nonce is in a final block under another hash, as
 * then its own can never be in one; never by its account's nonce moving on
 * alone, nor as sent by anything but its own transaction. Each is looked up
 * as the wallet opens, and again while it's open, until it's found, or
 * shown not sent, or the person is done with it. What's found of one
 * transaction changes what's kept of its send only while it's kept as that
 * one: another tab may have sent it again since, as another.
 */

import { get, writable } from "svelte/store";

import { noteNeverSent, noteSentOutcome } from "$lib/activity";
import { networkStore, walletStore } from "$lib/stores";
import { walletDataScope } from "$lib/wallets/dataNames";

import { FOLLOW_INTERVAL, FOLLOW_TIMEOUT } from "./followTransaction";
import transactionAtNonce from "./transactionAtNonce";
import transactionInBlock from "./transactionInBlock";
import { dropHandedOver, keepNotSent, unsentSends } from "./unsentSends";

/** How long the network gets to answer each time it's asked, in milliseconds. */
const ANSWER_WITHIN = 10_000;

/**
 * How often one not found in its first FOLLOW_TIMEOUT is looked up from
 * then on, and how often its nonce is, in milliseconds: a minute.
 */
const LOOK_AGAIN_EVERY = 60_000;

/**
 * The fewest seconds a block takes: no more blocks than so many seconds
 * apart came since a send was made.
 */
const BLOCK_SECONDS = 10;

/**
 * How many blocks before a send was made its account's transactions are
 * read from, for the one that took its nonce: an hour's.
 */
const BLOCKS_BEFORE = 360;

/** How long a send found on the chain is said so in its notice's place, in milliseconds. */
export const FOUND_SAID_FOR = 8_000;

/**
 * What the chain says of it: the block its transaction is in, as
 * followTransaction gives it.
 *
 * @typedef {import("./followTransaction").FinalTransaction} WentOut
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

  return unlessAborted(transactionInBlock(network, hash, signal), signal);
}

/**
 * Looks up which transaction of a send's account took its nonce, in a final
 * block: from about an hour before the send was made, by the latest block's
 * height, on. Null where none did yet, or where the send has no nonce, as a
 * shielded one. It rejects where the network doesn't answer before `signal`
 * aborts. The nonces read are kept in `known`, by hash.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @param {{ from: number | null, known: Map<string, string> }} reading
 *   `from` the block read from, kept once it's known
 * @param {AbortSignal} signal
 * @returns {Promise<{ blockHeight: number, hash: string } | null>}
 */
export async function lookUpNonceTaker(send, reading, signal) {
  const { nonce } = /** @type {{ nonce: string }} */ (send.handedOver);

  if (!nonce) {
    return null;
  }

  const network = await unlessAborted(networkStore.connect(), signal);

  if (reading.from === null) {
    const tip = await unlessAborted(
      networkStore.getCurrentBlockHeight(signal),
      signal
    );
    const since = Math.ceil(
      Math.max(0, Date.now() - send.at) / (BLOCK_SECONDS * 1000)
    );

    reading.from = Math.max(0, Number(tip) - since - BLOCKS_BEFORE);
  }

  return unlessAborted(
    transactionAtNonce(
      network,
      { account: send.account, from: reading.from, nonce },
      { known: reading.known, signal }
    ),
    signal
  );
}

/**
 * The transactions handed over not found on the chain yet, by their hash:
 * "checking" until it first answers, then "unconfirmed". A send sent again
 * is another transaction, with a state of its own.
 *
 * @type {import("svelte/store").Writable<Map<string, "checking" | "unconfirmed">>}
 */
const states = writable(new Map());

/**
 * Whether each transaction handed over is still looked up for the first
 * time, or wasn't found on the chain, by its hash: once it's found, its send
 * is no longer kept as it.
 */
export const handedOverStates = { subscribe: states.subscribe };

/**
 * @param {string} hash
 * @param {"checking" | "unconfirmed" | null} state
 */
function setState(hash, state) {
  states.update((map) => {
    const next = new Map(map);

    if (state) {
      next.set(hash, state);
    } else {
      next.delete(hash);
    }

    return next;
  });
}

/**
 * The sends found on the chain a moment ago, with what the chain says of
 * them: each said so in its notice's place for FOUND_SAID_FOR, once the
 * balances were read again and History says it too.
 *
 * @type {import("svelte/store").Writable<Array<{ send: import("./unsentSends").UnsentSend, wentOut: WentOut }>>}
 */
const found = writable([]);

/** The sends found on the chain a moment ago, to say so in their notice's place. */
export const foundSends = { subscribe: found.subscribe };

/**
 * Says a send was found on the chain, for FOUND_SAID_FOR.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @param {WentOut} wentOut
 */
function sayFound(send, wentOut) {
  const said = { send, wentOut };

  found.update((list) => [...list, said]);
  setTimeout(() => {
    found.update((list) => list.filter((each) => each !== said));
  }, FOUND_SAID_FOR);
}

/**
 * The transactions followed, by the wallet's opening and their hash: each
 * by one follow at a time, and by another once that one stops without an
 * answer, where its send is kept as it again.
 *
 * @type {Set<string>}
 */
const followed = new Set();

/** What ends the follows' waits at once: see `lookAgainNow`. */
let woken = Promise.withResolvers();

/**
 * Looks every send followed up again now, not at its next turn: as the
 * balances change, as a block with one of them may have changed them.
 */
export function lookAgainNow() {
  woken.resolve(undefined);
  woken = Promise.withResolvers();
}

/**
 * Waits, or less, where the follows are woken meanwhile.
 *
 * @param {number} milliseconds
 */
const pause = (milliseconds) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);

    woken.promise.then(() => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });

/**
 * Waits for `promise`, for `milliseconds` at most.
 *
 * @param {Promise<unknown>} promise
 * @param {number} milliseconds
 */
const within = (promise, milliseconds) => {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * Whether a send is kept still as the transaction `hash`, and no tab sends
 * it: not once the person is done with it, nor once another tab found it
 * on the chain, nor once it's sent again, as another transaction.
 *
 * @param {string} id
 * @param {string} hash
 */
const isKeptAs = (id, hash) =>
  get(unsentSends).some(
    (send) => send.id === id && send.handedOver?.hash === hash
  );

/**
 * Looks the transaction a send was handed over as up on the chain, now and
 * again while the wallet it's kept for is open and it's kept as it: often
 * at first, as a block may take it any moment, then once a minute, never
 * given up on, and at once as the balances change (`lookAgainNow`). Once
 * it's found, the balances are read again, for as long as the network gets
 * to answer, then History says so of it as of its block, its send is no
 * longer kept, and it's said found in its notice's place (`foundSends`):
 * the total, History and the notice say it together, unless the wallet's
 * sync takes longer. Its nonce is looked up once a minute, from the first
 * look on: once another transaction of its account took it, in a final
 * block, History no longer shows it, and its send is kept as one that never
 * went out. Its send is changed only while it's kept as it.
 *
 * @param {import("./unsentSends").UnsentSend} send
 */
export function followHandedOver(send) {
  const scope = walletDataScope();

  if (!send.handedOver) {
    return;
  }

  const { hash } = send.handedOver;
  const key = `${scope.id}:${hash}`;

  if (followed.has(key)) {
    return;
  }

  followed.add(key);
  setState(hash, "checking");

  const often = Date.now() + FOLLOW_TIMEOUT;

  /** Its account's transactions read, for the one that took its nonce. */
  const reading = {
    from: /** @type {number | null} */ (null),
    known: /** @type {Map<string, string>} */ (new Map()),
  };

  /** When its nonce was last looked up: never yet. */
  let nonceLookedUpAt = -Infinity;

  /** Whether the chain answered for good: found, or its nonce taken. */
  let isAnswered = false;

  void (async () => {
    while (scope.isOpen() && isKeptAs(send.id, hash)) {
      const wentOut = await lookUpHandedOver(
        send,
        AbortSignal.timeout(ANSWER_WITHIN)
      ).catch(() => null);

      if (!scope.isOpen()) {
        break;
      }

      if (wentOut) {
        // The balances first, so the total changes with History and the
        // notice: as long as the network gets to answer, as a sync that
        // hangs holds the read up.
        await within(
          walletStore.refreshBalance().catch(() => {}),
          ANSWER_WITHIN
        );

        if (!scope.isOpen()) {
          break;
        }

        isAnswered = true;
        await noteSentOutcome(hash, wentOut).catch(() => {});
        setState(hash, null);
        sayFound(send, wentOut);
        await dropHandedOver(send.id, hash).catch(() => {});

        break;
      }

      if (Date.now() - nonceLookedUpAt >= LOOK_AGAIN_EVERY) {
        nonceLookedUpAt = Date.now();

        const taker = await lookUpNonceTaker(
          send,
          reading,
          AbortSignal.timeout(ANSWER_WITHIN)
        ).catch(() => null);

        if (!scope.isOpen()) {
          break;
        }

        // Another transaction took its nonce: this one can never be in a
        // block.
        if (taker && taker.hash !== hash.toLowerCase()) {
          noteNeverSent(hash).catch(() => {});

          try {
            await keepNotSent(send.id, hash);
            isAnswered = true;

            break;
          } catch {
            // Storage refused: looked up again at its next turn.
          }
        }
      }

      setState(hash, "unconfirmed");
      await pause(Date.now() < often ? FOLLOW_INTERVAL : LOOK_AGAIN_EVERY);
    }

    setState(hash, null);

    // Another wallet opened, or none, or the person is done with it, or it
    // was sent again, as another transaction: one kept as this one again,
    // as once no tab sends it, is looked up again.
    if (!isAnswered) {
      followed.delete(key);
    }
  })();
}
