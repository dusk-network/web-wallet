import { derived, writable } from "svelte/store";

import { sozuPools } from "$lib/sozu/config";
import nodeNetwork from "$lib/stores/nodeNetwork";
import { tellOtherTabs } from "$lib/wallets/tabs";

import { ACTIVITY_PAGE, ActivitySession } from "./activitySession";
import {
  changeLocalTransactions,
  forgetLocalTransaction,
} from "./activityStore";
import { awaitedArrivals } from "./arrivals";
import { NOT_SHOWN, THIS_PAGE } from "./constants";

export { clearActivityStore, forgetWalletActivity } from "./activityStore";
export {
  arrivalsNotIn,
  awaitArrival,
  awaitedArrivals,
  forgetArrivals,
  isToAnotherProfile,
} from "./arrivals";
export { getShieldedHistory } from "./shieldedHistory";
export { notConfirmed, onTheirWay } from "./sends";
export { TX_KIND } from "./constants";

export { ACTIVITY_PAGE, ActivitySession };

/** @type {import("./activitySession").ActivityState} */
const emptyState = Object.freeze({
  complete: false,
  error: null,
  hasMore: false,
  loaded: false,
  rows: [],
  syncing: false,
});

const state = writable(emptyState);

/** @type {ActivitySession | null} */
let current = null;

/** @type {(() => void) | null} */
let unsubscribe = null;

/** The history of the account the wallet shows: its rows, and how its sync goes. */
export const activityState = { subscribe: state.subscribe };

/**
 * All of the history of the account shown that this device keeps, newest
 * first, read again as it changes: what a search covers, not only the page
 * History shows. The rows shown until it's read, and where it can't be.
 *
 * @type {import("svelte/store").Readable<ActivityRow[]>}
 */
export const keptActivity = derived(state, ($state, set) => {
  let isCurrent = true;
  const session = current;

  set($state.rows);
  session
    ?.keptRows()
    .then((kept) => {
      if (isCurrent && session === current) {
        // A row the history shows is the latest said of it.
        const shown = new Map($state.rows.map((row) => [row.hash, row]));
        const keptHashes = new Set(kept.map(({ hash }) => hash));

        set([
          ...$state.rows.filter(({ hash }) => !keptHashes.has(hash)),
          ...kept.map((row) => shown.get(row.hash) ?? row),
        ]);
      }
    })
    .catch(() => {});

  return () => {
    isCurrent = false;
  };
});

/** Tells the shown history's state again: its rows are read again. */
const tellAgain = () => current && state.set(current.state);

// The node's network and Sozu's pools say what the rows' calls did.
nodeNetwork.subscribe(tellAgain);
sozuPools.subscribe(tellAgain);

// A payment to the account shown, from another profile here, went out: the
// history looks for it.
awaitedArrivals.subscribe(() => current?.lookForArrivals());

/**
 * The history session for an account, made and started on first use. The
 * one before it, for another account or node, stops.
 *
 * @param {import("./activitySession").ActivitySessionOptions} options
 * @returns {ActivitySession}
 */
export function activityFor(options) {
  if (current?.key === `${options.nodeUrl}\n${options.account}`) {
    return current;
  }

  stopActivity();

  const session = new ActivitySession(options);

  current = session;
  unsubscribe = session.subscribe((next) => state.set(next));
  session.start().catch(() => {});

  return session;
}

/**
 * Whether the history is on: it is unless VITE_FEATURE_TRANSACTION_HISTORY
 * is "false".
 */
export const isHistoryEnabled = () =>
  import.meta.env.VITE_FEATURE_TRANSACTION_HISTORY !== "false";

/** The running history session, if any. */
export const currentActivity = () => current;

/**
 * What the chain says of a transaction the wallet sent, as the screen that
 * follows it says it, from the block that took it: History and Home say it
 * too from then on, for whichever profile sent it, until the archive has it.
 *
 * @param {string} hash
 * @param {import("$lib/transactions/followTransaction").FinalTransaction} outcome
 */
export async function noteSentOutcome(
  hash,
  { blockHeight, error, fee, timestamp }
) {
  const owners = await changeLocalTransactions(hash, {
    blockHeight: Number(blockHeight),
    feePaid: String(fee),
    handing: undefined,
    status: error ? "failed" : "executed",
    ...(error ? { error } : {}),
    ...(timestamp ? { timestamp } : {}),
  });

  if (owners.length) {
    if (current && owners.includes(current.ownerKey)) {
      await current.keptChanged();
    }

    tellOtherTabs({ type: "sent" });
  }
}

/**
 * Changes the wallet's records of a transaction it sent, for whichever
 * profile sent it, where `isToChange` says so of one: History and Home say
 * it as changed, here and in the other tabs.
 *
 * @param {string} hash
 * @param {Partial<ActivityLocalRecord>} change
 * @param {(record: ActivityLocalRecord) => boolean} isToChange
 */
async function changeSent(hash, change, isToChange) {
  const owners = await changeLocalTransactions(hash, change, isToChange);

  if (owners.length) {
    if (current && owners.includes(current.ownerKey)) {
      await current.keptChanged();
    }

    tellOtherTabs({ type: "sent" });
  }
}

/**
 * Whether a record is kept unseen as being handed to the node by another
 * page, which went before the node answered: its hand-over never finished.
 *
 * @param {ActivityLocalRecord} record
 */
const isHandingElsewhere = ({ handing, status }) =>
  status === NOT_SHOWN && Boolean(handing) && handing !== THIS_PAGE;

/**
 * A transaction the wallet sent whose answer never came, as its page went
 * before it did, or the node's answer got lost: it may have gone out, and
 * History and Home say it's not confirmed yet, never sent or on its way,
 * for whichever profile sent it, until the chain says what became of it
 * (`noteSentOutcome`), the node does (`noteInQueue`, `noteNotSentYet`), or
 * another took its nonce (`noteNeverSent`). Only while nothing else is said
 * of it, and of one not shown as its hand-over never finished, its page
 * gone first: with `handing`, also of one not shown yet, as the node was
 * asked to broadcast it and hadn't answered.
 *
 * @param {string} hash
 * @param {{ handing?: boolean }} [options]
 */
export const noteUnconfirmed = (hash, { handing = false } = {}) =>
  changeSent(
    hash,
    { handing: undefined, status: "unknown" },
    (record) =>
      record.status === "submitted" ||
      record.status === "mempool" ||
      isHandingElsewhere(record) ||
      (handing && record.status === NOT_SHOWN)
  );

/**
 * A transaction the wallet sent that the node didn't have, handed to it
 * again as it is: kept unseen as being handed over by this page until the
 * node answers, for whichever profile sent it, so that it's said not to be
 * confirmed yet where the page goes first.
 *
 * @param {string} hash
 */
export const noteHanding = (hash) =>
  changeSent(
    hash,
    { handing: THIS_PAGE },
    ({ status }) => status === NOT_SHOWN
  );

/**
 * A transaction the wallet sent that the node took as it was asked to
 * broadcast it, now or again: History and Home say it's sent, on its way,
 * from now, for whichever profile sent it, where they didn't show it or
 * said it wasn't confirmed.
 *
 * @param {string} hash
 */
export const noteSentAccepted = (hash) =>
  changeSent(
    hash,
    { handing: undefined, status: "submitted", submittedAt: Date.now() },
    ({ status }) => status === NOT_SHOWN || status === "unknown"
  );

/**
 * A transaction the wallet sent that the node has in its mempool: History
 * and Home say it's sent, on its way, for whichever profile sent it, for as
 * long as it's there.
 *
 * @param {string} hash
 */
export const noteInQueue = (hash) =>
  changeSent(
    hash,
    { handing: undefined, status: "mempool" },
    ({ status }) =>
      status === NOT_SHOWN || status === "submitted" || status === "unknown"
  );

/**
 * A transaction the wallet sent that the node doesn't have, in a block or
 * in its mempool, while its nonce is still free: History and Home don't
 * show it, for whichever profile sent it, as not being handed over either,
 * until it's sent again as it is (`noteSentAccepted`).
 *
 * @param {string} hash
 */
export const noteNotSentYet = (hash) =>
  changeSent(
    hash,
    { handing: undefined, status: NOT_SHOWN },
    ({ handing, status }) =>
      status === "submitted" ||
      status === "mempool" ||
      status === "unknown" ||
      (status === NOT_SHOWN && Boolean(handing))
  );

/**
 * A transaction the wallet sent that can never be in a block, as another
 * took its nonce: History and Home no longer show it, for whichever profile
 * sent it.
 *
 * @param {string} hash
 */
export async function noteNeverSent(hash) {
  const owners = await forgetLocalTransaction(hash);

  if (owners.length) {
    if (current && owners.includes(current.ownerKey)) {
      await current.keptChanged();
    }

    tellOtherTabs({ type: "sent" });
  }
}

/** Stops the history session, for a lock, a reset or another profile. */
export function stopActivity() {
  current?.stop();
  unsubscribe?.();
  current = null;
  unsubscribe = null;
  state.set(emptyState);
}
