/**
 * Watches every transfer the wallet knows of for the moment it ends, for as
 * long as the wallet is open, on whichever page, to say so to whoever isn't
 * looking, a send whose Sent screen was left before a block took it too. What
 * a transfer was as it was first seen says nothing: only a change does. With the notice chosen, or where the title is the one way to be told,
 * the transfers under way are read with the page hidden too, and those on
 * DuskEVM taken up again as the wallet opens: only a bridge screen does otherwise.
 */

import { get } from "svelte/store";

import { goto } from "$lib/navigation";
import { settingsStore, walletStore } from "$lib/stores";
import nodeNetwork from "$lib/stores/nodeNetwork";
import {
  depositActivityStore,
  resumeRecentDeposits,
} from "$lib/bridge/depositActivity";
import { formatDuskExact } from "$lib/dusk/currency";

import { transferOutcome } from "$lib/components/EvmTransactions/bridgeActivity";

import {
  arrivalNoticeState,
  arrivalSeen,
  forgetArrivalTitle,
  transferEnded,
} from "./arrivalNotice";
import { followRouteTransfers } from "./routeFollowing";
import { followSends } from "./sendArrival";
import { routeTransfers } from "./routeHistory";
import { getWithdrawalFinalizationConfig } from "./withdrawals";
import {
  resumeUnsettledWithdrawals,
  withdrawalActivityStore,
} from "./withdrawalTracking";

const WEI_PER_LUX = 1_000_000_000n;

/**
 * What a deposit or withdrawal is, in words: "It", with balances hidden.
 *
 * @param {{ amountLux?: string | null, amountWei?: string | null }} item
 */
function whatOf({ amountLux, amountWei }) {
  const { hideBalances, language } = get(settingsStore);
  const lux = /^\d+$/.test(amountLux ?? "")
    ? BigInt(/** @type {string} */ (amountLux))
    : /^\d+$/.test(amountWei ?? "")
      ? BigInt(/** @type {string} */ (amountWei)) / WEI_PER_LUX
      : null;

  return hideBalances || lux === null
    ? "It"
    : `${formatDuskExact(lux, language)} DUSK`;
}

const DIDNT = "It didn't go through";

/**
 * @typedef {{ key: string, says: () => string } | null} End What a transfer
 *   ended as: the kind of end, which a change of it is news by, and what says
 *   it as balances show when it's said; null while it's under way.
 */

/**
 * An end, said as `say` says it when it's said.
 *
 * @param {string} key
 * @param {() => string} say
 * @returns {End}
 */
const endAs = (key, say) => ({ key, says: say });

/**
 * What a transfer between Dusk and another chain says of how it went, as
 * balances show now.
 *
 * @param {import("./migrationActivity").RouteTransfer} transfer
 */
function routeOutcome(transfer) {
  const { hideBalances, language } = get(settingsStore);

  return transferOutcome(transfer, {
    locale: language,
    masked: hideBalances,
  });
}

/**
 * What a transfer between Dusk and another chain ended as.
 *
 * @param {import("./migrationActivity").RouteTransfer} transfer
 * @returns {End}
 */
function routeTransferEnd(transfer) {
  const heading = routeOutcome(transfer)?.heading;

  return heading
    ? endAs(heading, () => {
        const outcome = routeOutcome(transfer);

        return outcome?.heading === "Arrived"
          ? outcome.sentence.replace(/\.$/, "")
          : (outcome?.heading ?? heading);
      })
    : null;
}

/** How long ago a transfer may have ended for its end to be news: a day. */
const NEWS_FOR_MS = 86_400_000;

/**
 * What a transfer between Dusk and another chain says it ended as, where it
 * ended in the last day, or when isn't known: a migration whose payout comes
 * to light only as the history is read further back was paid long before,
 * and is no news.
 *
 * @param {import("./migrationActivity").RouteTransfer} transfer
 */
function routeTransferNews(transfer) {
  const endedAt = transfer.paidAt ?? transfer.arrivedAt ?? null;

  return endedAt !== null && Date.now() - endedAt > NEWS_FOR_MS
    ? null
    : routeTransferEnd(transfer);
}

/**
 * @param {any} deposit
 * @returns {End}
 */
const depositEnd = (deposit) =>
  deposit.stage === "completed"
    ? endAs("completed", () => `${whatOf(deposit)} arrived on DuskEVM`)
    : deposit.stage === "failed"
      ? endAs("failed", () => DIDNT)
      : null;

/** What a withdrawal's step that asks something says. */
const WITHDRAWAL_STEPS = /** @type {Record<string, string>} */ ({
  failed: DIDNT,
  ready_to_finalize: "Ready to claim on Dusk",
  ready_to_prove: "Ready to prove on Dusk",
});

/**
 * @param {any} withdrawal
 * @returns {End}
 */
function withdrawalEnd(withdrawal) {
  const { stage } = withdrawal;

  return stage === "finalized"
    ? endAs(stage, () => `${whatOf(withdrawal)} arrived on Dusk`)
    : WITHDRAWAL_STEPS[stage]
      ? endAs(stage, () => WITHDRAWAL_STEPS[stage])
      : null;
}

/**
 * Says each change a list makes from one thing to another that ends
 * something: by the kind of end, so that balances shown or hidden since say
 * nothing new, in words decided as they're said.
 *
 * @template T
 * @param {(item: T) => string} idOf
 * @param {(item: T) => string} hashOf
 * @param {(item: T) => End} endOf What it ended as
 */
function watcher(idOf, hashOf, endOf) {
  /** @type {Map<string, string>} */
  const seen = new Map();

  /** @param {T[]} items */
  return (items) => {
    for (const item of items) {
      const id = idOf(item);
      const end = endOf(item);
      const before = seen.get(id);

      seen.set(id, end?.key ?? "");

      if (before !== undefined && end && end.key !== before) {
        const href = `/dashboard/bridge/transactions?tx=${hashOf(item)}`;

        transferEnded({
          href,
          id,
          onOpen: () => goto(href),
          title: end.says,
        });
      }
    }
  };
}

/** @returns {() => void} Stops */
export function followArrivals() {
  // Sends whose Sent screen was left before a block took them.
  let stopSends = followSends();

  const stops = [
    routeTransfers.subscribe(
      watcher(
        ({ hash, kind }) => `${kind}:${hash}`,
        ({ hash }) => hash,
        routeTransferNews,
      ),
    ),
    depositActivityStore.subscribe(
      watcher(
        (/** @type {any} */ { transactionHash }) =>
          `deposit:${transactionHash}`,
        (/** @type {any} */ { transactionHash }) => transactionHash,
        depositEnd,
      ),
    ),
    withdrawalActivityStore.subscribe(
      watcher(
        (/** @type {any} */ { transactionHash }) =>
          `withdrawal:${transactionHash}`,
        (/** @type {any} */ { transactionHash }) => transactionHash,
        withdrawalEnd,
      ),
    ),
  ];

  /** @type {(() => void) | null} */
  let stopFollowing = null;

  const takeUpDuskEvm = () => {
    if (
      get(nodeNetwork)?.routes.duskEvm.length ||
      getWithdrawalFinalizationConfig().configured
    ) {
      resumeRecentDeposits();
      resumeUnsettledWithdrawals();
    }
  };

  // Told, it's followed for a day from wherever the wallet is: a stuck
  // transfer costs no reads otherwise.
  const stopState = arrivalNoticeState.subscribe((state) => {
    if (state === "offer") {
      stopFollowing?.();
      stopFollowing = null;
    } else {
      stopFollowing ??= followRouteTransfers({ recentOnly: true });
      takeUpDuskEvm();
    }
  });

  // Another wallet here has its own.
  let openKey = get(walletStore).walletKey;
  const stopWallet = walletStore.subscribe(({ walletKey }) => {
    if (walletKey !== openKey) {
      openKey = walletKey;
      // Another wallet's: what the one before sent is said no more.
      stopSends();
      stopSends = followSends();

      if (stopFollowing) {
        takeUpDuskEvm();
      }
    }
  });

  window.addEventListener("focus", arrivalSeen);
  document.addEventListener("visibilitychange", arrivalSeen);

  return () => {
    stops.forEach((stop) => stop());
    stopState();
    stopWallet();
    stopSends();
    stopFollowing?.();
    window.removeEventListener("focus", arrivalSeen);
    document.removeEventListener("visibilitychange", arrivalSeen);
    forgetArrivalTitle();
  };
}
