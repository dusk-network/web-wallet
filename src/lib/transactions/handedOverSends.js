/**
 * What the chain and the node say of a send kept on this device that was
 * handed to the node and whose answer never came, as its page went first or
 * the answer got lost ($lib/transactions/unsentSends): it went out, or
 * failed, only as its own transaction, found by its hash in a block, says;
 * the node has it in its mempool, on its way; or the node doesn't have it,
 * in a block or its mempool, and its nonce is still free on the chain:
 * nothing left the wallet, and it's said as not sent yet, to send again as
 * it is, its very bytes, so its hash and nonce, which can never pay twice,
 * or not at all. It's said as not sent, its account having sent something
 * else, only once its account's transaction with its nonce is in a final
 * block under another hash, as then its own can never be in one; never by
 * its account's nonce moving on alone, nor as sent by anything but its own
 * transaction. Until the node and the chain answer, it may have gone out,
 * and the person checks before sending it again. Each is looked up as the
 * wallet opens, and again while it's open, until it's found, or shown not
 * sent, or the person is done with it. One the person chose not to send,
 * as not sent yet, is looked up all the same until its nonce is taken, as
 * the broadcast whose answer got lost may still go through: by it, it's
 * said as sent; by another, it's done with. What's found of one transaction
 * changes what's kept of its send only while it's kept as that one: another
 * tab may have sent it again since, as another.
 */

import { get, writable } from "svelte/store";

import {
  noteHanding,
  noteInQueue,
  noteNeverSent,
  noteNotSentYet,
  noteSentAccepted,
  noteSentOutcome,
  noteUnconfirmed,
} from "$lib/activity";
import WalletChangedError from "$lib/errors/wallet-changed-error";
import { networkStore, walletStore } from "$lib/stores";
import networkReach from "$lib/stores/networkReach";
import { walletDataScope } from "$lib/wallets/dataNames";

import describeFailure from "./describeFailure";
import { FOLLOW_INTERVAL, FOLLOW_TIMEOUT } from "./followTransaction";
import { isOutcomeUnknown } from "./outcomeUnknown";
import transactionAtNonce from "./transactionAtNonce";
import transactionInBlock from "./transactionInBlock";
import {
  actOnHandedOver,
  dismissHandedOver,
  dropHandedOver,
  keepNotSent,
  unsentSends,
} from "./unsentSends";

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
 * Whether the node has a transaction in its mempool, by its hash. It
 * rejects where the network doesn't answer before `signal` aborts, or
 * doesn't say.
 *
 * @param {string} hash
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>}
 */
export async function inMempool(hash, signal) {
  const network = await unlessAborted(networkStore.connect(), signal);
  const said = await unlessAborted(
    network.query(`queued: mempoolTx(hash: "${hash}") { id }`, { signal }),
    signal
  );

  if (!said || typeof said !== "object" || !("queued" in said)) {
    throw new Error("The node didn't say what its mempool holds");
  }

  return Boolean(said.queued);
}

/**
 * Whether a send's nonce is still free on the chain: its account's nonce,
 * as the node has it now, is below it. Null where that can't be said: a
 * send with no nonce, as a shielded one, or from a profile the wallet open
 * doesn't have. It rejects where the network doesn't answer before `signal`
 * aborts.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @param {AbortSignal} signal
 * @returns {Promise<boolean | null>}
 */
export async function isNonceFree(send, signal) {
  const nonce = send.handedOver?.nonce ?? "";
  const profile = get(walletStore).profiles.find(
    (each) => String(each.account) === send.account
  );

  if (!nonce || !profile) {
    return null;
  }

  const syncer = await unlessAborted(networkStore.getAccountSyncer(), signal);
  const [read] = await unlessAborted(syncer.balances([profile]), signal);

  return BigInt(read.nonce) < BigInt(nonce);
}

/**
 * Where a transaction handed over is, as the node and the chain said last:
 * "checking" until they first answer; "pending" in the node's mempool;
 * "not-sent" nowhere, its nonce still free; "sending" as it's sent again;
 * and "unconfirmed" where they can't say. Once it's found in a block, or
 * another transaction took its nonce, its send is no longer kept as it. A
 * send sent again through Review is another transaction, with a state of
 * its own.
 *
 * @typedef {"checking" | "not-sent" | "pending" | "sending" | "unconfirmed"} HandedOverState
 */

/**
 * The transactions handed over not found on the chain yet, by their hash.
 *
 * @type {import("svelte/store").Writable<Map<string, HandedOverState>>}
 */
const states = writable(new Map());

/**
 * Where each transaction handed over is, by its hash, as the node and the
 * chain said last (HandedOverState).
 */
export const handedOverStates = { subscribe: states.subscribe };

/**
 * What stopped each transaction sent again from going, by its hash, as the
 * person is told: the network refused it, or couldn't be reached. Said until
 * it's sent again, or it's no longer not sent.
 *
 * @type {import("svelte/store").Writable<Map<string, string>>}
 */
const refusals = writable(new Map());

/** What stopped each transaction sent again from going, by its hash. */
export const sentAgainRefusals = { subscribe: refusals.subscribe };

/**
 * @param {string} hash
 * @param {string | null} why
 */
function setRefusal(hash, why) {
  refusals.update((map) => {
    const next = new Map(map);

    if (why) {
      next.set(hash, why);
    } else {
      next.delete(hash);
    }

    return next;
  });
}

/**
 * @param {string} hash
 * @param {HandedOverState | null} state
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
 * balances change, as a block with one of them may have changed them, and
 * as the network answers again.
 */
export function lookAgainNow() {
  woken.resolve(undefined);
  woken = Promise.withResolvers();
}

/** How the network answered as last found: answering until found not to. */
let reachBefore = "answering";

networkReach.subscribe((reach) => {
  if (reach === "answering" && reachBefore !== "answering") {
    lookAgainNow();
  }

  reachBefore = reach;
});

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
 * What's kept now of a send kept still as the transaction `hash`, while no
 * tab sends it: none once the person is done with it, nor once another tab
 * found it on the chain, nor once it's sent again, as another transaction.
 *
 * @param {string} id
 * @param {string} hash
 */
const keptAs = (id, hash) =>
  get(unsentSends).find(
    (send) => send.id === id && send.handedOver?.hash === hash
  );

/**
 * Whether a send is kept still as the transaction `hash` (`keptAs`).
 *
 * @param {string} id
 * @param {string} hash
 */
const isKeptAs = (id, hash) => Boolean(keptAs(id, hash));

/**
 * The transactions this tab sends again now, by their hash, until the node
 * answered: their state is the sending's to say meanwhile.
 *
 * @type {Set<string>}
 */
const sendingAgain = new Set();

/**
 * How long a transaction the node took as it was sent again is on its way,
 * though the node's mempool doesn't show it yet, in milliseconds: the node
 * takes it in a moment, and a block soon after.
 */
const TAKEN_FOR = 30_000;

/**
 * When the node took each transaction sent again, by its hash: on its way
 * for TAKEN_FOR from then, whatever a look begun before said.
 *
 * @type {Map<string, number>}
 */
const takenAt = new Map();

/**
 * Says where a transaction handed over is, and History with it, each time
 * it's looked up, whatever it said before: on its way while the node has it
 * in its mempool, not shown while it doesn't have it and its nonce is free,
 * and as it was while neither can be said. Not while it's sent again: that
 * sending says it.
 *
 * @param {string} hash
 * @param {HandedOverState} state
 */
function sayState(hash, state) {
  if (sendingAgain.has(hash)) {
    return;
  }

  setState(hash, state);

  if (state !== "not-sent") {
    setRefusal(hash, null);
  }

  if (state === "pending") {
    noteInQueue(hash).catch(() => {});
  } else if (state === "not-sent") {
    noteNotSentYet(hash).catch(() => {});
  }
}

/**
 * Looks the transaction a send was handed over as up on the chain and in
 * the node, now and again while the wallet it's kept for is open and it's
 * kept as it: often at first, as a block may take it any moment, then once
 * a minute, never given up on, and at once as the balances change
 * (`lookAgainNow`). Once it's found in a block, the balances are read
 * again, for as long as the network gets to answer, then History says so of
 * it as of its block, its send is no longer kept, and it's said found in its
 * notice's place (`foundSends`): the total, History and the notice say it
 * together, unless the wallet's sync takes longer. In no block, the node's
 * mempool is asked for it: there, it's on its way; not there, with its
 * account's nonce on the chain still below its own, it's not sent yet, and
 * History doesn't show it. Once said not sent yet, it's so until the node or
 * the chain say otherwise, not where they can't be reached. Where its
 * account's nonce is used, or can't be read, its account's transactions are
 * looked up once a minute: once another of them took its nonce, in a final
 * block, History no longer shows it, and its send is kept as one that never
 * went out. Its send is changed only while it's kept as it. Until the chain
 * or the node says, History says it's not confirmed yet.
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
  // Its answer never came in the page that sent it: History says it's not
  // confirmed yet, never that it's on its way, until the chain says.
  noteUnconfirmed(hash).catch(() => {});

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
      // In a block: what took it; none where no block has it, or undefined
      // where that can't be said.
      const wentOut = await lookUpHandedOver(
        send,
        AbortSignal.timeout(ANSWER_WITHIN)
      ).catch(() => undefined);

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
        // As it's kept now: one the person chose not to send arrived after all.
        sayFound(keptAs(send.id, hash) ?? send, wentOut);
        await dropHandedOver(send.id, hash).catch(() => {});

        break;
      }

      /** What the node and the chain say of it, but for a block. */
      let state = /** @type {HandedOverState} */ ("unconfirmed");

      /** Whether its nonce is free: undefined where that can't be said. */
      let isFree;

      if (wentOut === null) {
        const queued = await inMempool(
          hash,
          AbortSignal.timeout(ANSWER_WITHIN)
        ).catch(() => undefined);

        if (!scope.isOpen()) {
          break;
        }

        if (queued) {
          state = "pending";
        } else if (queued === false) {
          isFree =
            (await isNonceFree(send, AbortSignal.timeout(ANSWER_WITHIN)).catch(
              () => undefined
            )) ?? undefined;

          if (!scope.isOpen()) {
            break;
          }

          if (isFree) {
            state = "not-sent";
          }
        }
      }

      // Taken by the node as it was sent again a moment ago: on its way.
      if (
        state === "not-sent" &&
        Date.now() - (takenAt.get(hash) ?? -Infinity) < TAKEN_FOR
      ) {
        state = "pending";
      }

      // Not sent yet as it was: not so only once the node or the chain say
      // otherwise, not where they can't be reached.
      if (
        state === "unconfirmed" &&
        isFree !== false &&
        get(states).get(hash) === "not-sent"
      ) {
        state = "not-sent";
      }

      if (
        state === "unconfirmed" &&
        Date.now() - nonceLookedUpAt >= LOOK_AGAIN_EVERY
      ) {
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
        // block. One the person chose not to send is done with; another is
        // said as not sent, its account having sent something else.
        if (taker && taker.hash !== hash.toLowerCase()) {
          noteNeverSent(hash).catch(() => {});

          try {
            await (keptAs(send.id, hash)?.handedOver?.dismissed
              ? dropHandedOver(send.id, hash)
              : keepNotSent(send.id, hash));
            isAnswered = true;

            break;
          } catch {
            // Storage refused: looked up again at its next turn.
          }
        }
      }

      sayState(hash, state);
      await pause(Date.now() < often ? FOLLOW_INTERVAL : LOOK_AGAIN_EVERY);
    }

    setState(hash, null);
    setRefusal(hash, null);

    // Another wallet opened, or none, or the person is done with it, or it
    // was sent again, as another transaction: one kept as this one again,
    // as once no tab sends it, is looked up again.
    if (!isAnswered) {
      followed.delete(key);
    }
  })();
}

/**
 * Sends a transaction that was handed over, and that the node said it
 * doesn't have, its nonce still free (not sent yet), again as it is: its
 * very bytes, so its hash and nonce, which a block can take once at most,
 * through the wallet open (`walletStore.sendAgain`). It's said as sending
 * meanwhile. Once the node took it, it's on its way, in History too; refused,
 * or with the network out of reach, it's not sent yet still, and why is said
 * (`sentAgainRefusals`); where its answer got lost, it's not confirmed yet,
 * in History too. Either way it's looked up again at once. It's sent as
 * storage keeps it, while no other tab acts on it (`actOnHandedOver`):
 * nothing is sent where its bytes weren't kept, where it's no longer kept as
 * that transaction, or where the person chose not to send it, here or in
 * another tab.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @returns {Promise<void>}
 */
export async function sendHandedOverAgain(send) {
  const hash = send.handedOver?.hash ?? "";

  if (
    !send.handedOver?.tx ||
    send.handedOver.dismissed ||
    sendingAgain.has(hash) ||
    !isKeptAs(send.id, hash)
  ) {
    return;
  }

  sendingAgain.add(hash);
  setState(hash, "sending");
  setRefusal(hash, null);

  /** @type {HandedOverState} */
  let state = "pending";

  /** @type {string | null} */
  let why = null;

  try {
    const isSent = await actOnHandedOver(send.id, hash, async (kept) => {
      const { dismissed, nonce = "", tx = "" } = kept?.handedOver ?? {};

      if (!kept || dismissed || !tx) {
        return false;
      }

      // Handed over again: History says it's not confirmed yet where this
      // page goes before the node answers.
      await noteHanding(hash).catch(() => {});
      await walletStore.sendAgain({ account: kept.account, hash, nonce, tx });

      return true;
    });

    if (isSent) {
      takenAt.set(hash, Date.now());
      await noteSentAccepted(hash).catch(() => {});
    } else {
      // Not sent: as it was, unless another tab chose not to send it.
      state = "not-sent";
    }
  } catch (error) {
    const failure = describeFailure(/** @type {Error} */ (error));

    if (isOutcomeUnknown(error) || failure.outcomeUnknown) {
      // Its answer got lost, or the node has it already: for the next look
      // to say which, and not confirmed yet in History meanwhile.
      state = "unconfirmed";
      await noteUnconfirmed(hash, { handing: true }).catch(() => {});
    } else {
      // Nothing was broadcast: not sent yet still, and why, unless the
      // wallet changed meanwhile.
      state = "not-sent";
      await noteNotSentYet(hash).catch(() => {});
      why = failure.unreachable
        ? "Couldn't reach the network."
        : error instanceof WalletChangedError
          ? null
          : "The network refused it.";
    }
  } finally {
    sendingAgain.delete(hash);
  }

  if (isKeptAs(send.id, hash)) {
    setState(hash, state);
    setRefusal(hash, why);
  }

  lookAgainNow();
}

/**
 * Doesn't send a transaction that was handed over and that the node said it
 * doesn't have (not sent yet): it's never sent again from then on, here or
 * in another tab (`dismissHandedOver`), and not said, while no other tab
 * sends it (`actOnHandedOver`). It's still looked up until its nonce is
 * taken, as it may still arrive: by it, it's said as sent; by another, it's
 * done with. History doesn't show it meanwhile. Only while it's kept as that
 * transaction. Its nonce stays free, for the next send to take. True once
 * it's kept so.
 *
 * @param {import("./unsentSends").UnsentSend} send
 * @returns {Promise<boolean>}
 */
export async function dontSendHandedOver(send) {
  const hash = send.handedOver?.hash ?? "";
  const isDismissed = await actOnHandedOver(send.id, hash, (kept) =>
    kept && !kept.handedOver?.dismissed
      ? dismissHandedOver(send.id, hash)
      : Promise.resolve(false)
  ).catch(() => false);

  if (isDismissed) {
    setRefusal(hash, null);
  }

  return isDismissed;
}
