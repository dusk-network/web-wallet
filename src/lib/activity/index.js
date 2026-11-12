import { writable } from "svelte/store";

import { sozuPools } from "$lib/sozu/config";
import nodeNetwork from "$lib/stores/nodeNetwork";
import { tellOtherTabs } from "$lib/wallets/tabs";

import { ACTIVITY_PAGE, ActivitySession } from "./activitySession";
import { changeLocalTransactions } from "./activityStore";
import { awaitedArrivals } from "./arrivals";

export { clearActivityStore, forgetWalletActivity } from "./activityStore";
export {
  arrivalsNotIn,
  awaitArrival,
  awaitedArrivals,
  forgetArrivals,
  isToAnotherProfile,
} from "./arrivals";
export { getShieldedHistory } from "./shieldedHistory";
export { onTheirWay } from "./sends";
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

/** Stops the history session, for a lock, a reset or another profile. */
export function stopActivity() {
  current?.stop();
  unsubscribe?.();
  current = null;
  unsubscribe = null;
  state.set(emptyState);
}
