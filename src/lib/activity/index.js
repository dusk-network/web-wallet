import { writable } from "svelte/store";

import { ACTIVITY_PAGE, ActivitySession } from "./activitySession";
import { luxToDusk } from "$lib/dusk/currency";

export { clearActivityStore } from "./activityStore";
export { getShieldedHistory } from "./shieldedHistory";
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

/** Stops the history session, for a lock, a reset or another profile. */
export function stopActivity() {
  current?.stop();
  unsubscribe?.();
  current = null;
  unsubscribe = null;
  state.set(emptyState);
}

/**
 * The rows as the transactions list shows them: the transactions on chain,
 * with the amount as it changed the balance, in DUSK.
 *
 * @param {ActivityRow[]} rows
 * @returns {Transaction[]}
 */
export function asTransactions(rows) {
  return rows
    .filter((row) => Number.isSafeInteger(row.blockHeight))
    .map((row) => {
      // A failed transaction moved nothing but its fee.
      const amount =
        row.status === "failed" ? 0 : luxToDusk(BigInt(row.amount ?? 0));

      return {
        amount: row.direction === "in" || !amount ? amount : -amount,
        // eslint-disable-next-line camelcase
        block_height: Number(row.blockHeight),
        direction: row.direction === "in" ? "In" : "Out",
        fee: luxToDusk(BigInt(row.feePaid ?? 0)),
        id: row.hash,
        // eslint-disable-next-line camelcase
        tx_type: String(row.kind ?? "transfer").toUpperCase(),
      };
    });
}
