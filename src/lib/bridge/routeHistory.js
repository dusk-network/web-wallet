/**
 * The history, read again while the wallet is open and a transfer between
 * Dusk and another chain waits on it: a migration is paid on Dusk, and only
 * the history shows its payout; a transfer out shows once its send is in a
 * block. Each read carries on from where the last one got to. None is made
 * while nothing waits, or while the page is hidden. A change in the public
 * balance, as the wallet's sync finds one, reads it too: a payout of a
 * migration sent elsewhere is seen then. And a read that finds new public
 * transactions reads the balance again at once, as a send does.
 */

import { derived } from "svelte/store";

import { activityState, currentActivity } from "$lib/activity";
import { walletStore } from "$lib/stores";
import nodeNetwork from "$lib/stores/nodeNetwork";

import {
  keptMigrations,
  routeTransfersOf,
  transferArrivals,
} from "./migrationActivity";

/** How often the history is read while a transfer waits on it. */
export const FOLLOW_MS = 30_000;

/**
 * How long a migration is waited for: one not paid after a day is seen
 * when the balance changes.
 */
export const FOLLOW_FOR_MS = 86_400_000;

/**
 * Whether a transfer between Dusk and another chain waits on the history:
 * a migration to the account sent from here in the last day and not paid
 * yet, or a transfer out whose send isn't in a block yet.
 *
 * @param {{ now?: number, rows: ActivityRow[], transfers: import("./migrationActivity").RouteTransfer[] }} state
 */
export function waitsOnHistory({ now = Date.now(), rows, transfers }) {
  const pending = new Set(
    rows.filter(({ status }) => status === "pending").map(({ hash }) => hash)
  );

  return transfers.some(({ at, hash, kind, stage }) =>
    kind === "migration"
      ? (stage === "sending" || stage === "sent") &&
        now - (at ?? 0) < FOLLOW_FOR_MS
      : pending.has(hash)
  );
}

/** The public account the wallet shows: a sync's progress doesn't change it. */
const shownAccount = derived(walletStore, ({ currentProfile }) =>
  String(currentProfile?.account ?? "")
);

/**
 * The transfers between Dusk and another chain of the account the wallet
 * shows, as Bridge › Activity lists them: worked out again as the history,
 * the migrations sent from here or what's known of the transfers out
 * change.
 *
 * @type {import("svelte/store").Readable<import("./migrationActivity").RouteTransfer[]>}
 */
export const routeTransfers = derived(
  [activityState, keptMigrations, transferArrivals, nodeNetwork, shownAccount],
  ([$activity, $kept, $arrivals, $net, $account], set) => {
    let current = true;

    routeTransfersOf({
      account: $account,
      known: $arrivals,
      net: $net,
      rows: $activity.rows,
      sent: $kept,
    })
      .then((list) => current && set(list))
      .catch(() => {});

    return () => {
      current = false;
    };
  },
  /** @type {import("./migrationActivity").RouteTransfer[]} */ ([])
);

const waiting = derived(
  [routeTransfers, activityState],
  ([$transfers, $activity]) =>
    waitsOnHistory({ rows: $activity.rows, transfers: $transfers })
);

/**
 * Calls `read` when the public balance of the account the wallet shows
 * changes; not for another account's.
 *
 * @param {() => void} read
 * @returns {() => void} Stops
 */
function onBalanceChange(read) {
  let last = "";

  return walletStore.subscribe(({ balance, currentProfile }) => {
    const account = String(currentProfile?.account ?? "");
    const next = account ? `${account} ${balance.unshielded.value}` : "";

    if (next && next !== last && last.startsWith(`${account} `)) {
      read();
    }

    last = next || last;
  });
}

/**
 * Calls `refresh` when the history has public transactions in newer blocks
 * than it had: they changed the public balance. Not for those a history
 * starts with, nor for older ones shown later.
 *
 * @param {() => void} refresh
 * @returns {() => void} Stops
 */
function onNewTransactions(refresh) {
  /** @type {number | null} */
  let newest = null;

  return activityState.subscribe(({ loaded, rows }) => {
    if (!loaded) {
      newest = null;

      return;
    }

    const top = Math.max(
      0,
      ...rows
        .filter((row) => row.privacy !== "shielded" && row.source !== "sent")
        .map((row) => row.blockHeight ?? 0)
    );

    if (newest !== null && top > newest) {
      refresh();
    }

    newest = Math.max(newest ?? 0, top);
  });
}

/**
 * Reads the history every FOLLOW_MS while a transfer waits on it and the
 * page is shown, and when the public balance changes; reads the balance
 * again when the history finds new public transactions.
 *
 * @param {{ read?: () => void, refreshBalance?: () => void }} [options]
 *   `read` reads the history, `refreshBalance` the balance
 * @returns {() => void} Stops
 */
export function followRouteHistory({
  read = () => void currentActivity()?.refresh(),
  refreshBalance = () => void walletStore.refreshBalance(),
} = {}) {
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;

  const stopTimer = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const unsubscribe = waiting.subscribe((isWaiting) => {
    if (!isWaiting) {
      stopTimer();
    } else if (timer === undefined) {
      timer = setInterval(() => {
        if (document.visibilityState !== "hidden") {
          read();
        }
      }, FOLLOW_MS);
    }
  });
  const stopBalance = onBalanceChange(read);
  const stopRows = onNewTransactions(refreshBalance);

  return () => {
    unsubscribe();
    stopBalance();
    stopRows();
    stopTimer();
  };
}
