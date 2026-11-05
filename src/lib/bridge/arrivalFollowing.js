/**
 * Watches every transfer the wallet knows of for the moment it ends, for as
 * long as the wallet is open, on whichever page, to say so to whoever isn't
 * looking. What a transfer was as it was first seen says nothing: only a change
 * does. With the notice chosen, or where the title is the one way to be told,
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
 * What a transfer between Dusk and another chain says it ended as: "" while
 * it's under way.
 *
 * @param {import("./migrationActivity").RouteTransfer} transfer
 */
function routeTransferEnd(transfer) {
  const { hideBalances, language } = get(settingsStore);
  const outcome = transferOutcome(transfer, {
    locale: language,
    masked: hideBalances,
  });

  return !outcome?.heading
    ? ""
    : outcome.heading === "Arrived"
      ? outcome.sentence.replace(/\.$/, "")
      : outcome.heading;
}

/** @param {any} deposit */
const depositEnd = (deposit) =>
  deposit.stage === "completed"
    ? `${whatOf(deposit)} arrived on DuskEVM`
    : deposit.stage === "failed"
      ? DIDNT
      : "";

/** @param {any} withdrawal */
function withdrawalEnd(withdrawal) {
  switch (withdrawal.stage) {
    case "finalized":
      return `${whatOf(withdrawal)} arrived on Dusk`;
    case "failed":
      return DIDNT;
    case "ready_to_prove":
      return "Ready to prove on Dusk";
    case "ready_to_finalize":
      return "Ready to claim on Dusk";
    default:
      return "";
  }
}

/**
 * Says each change a list makes from one thing to another that ends something.
 *
 * @template T
 * @param {(item: T) => string} idOf
 * @param {(item: T) => string} hashOf
 * @param {(item: T) => string} endOf What it ended as: "" while it's under way
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

      seen.set(id, end);

      if (before !== undefined && end && end !== before) {
        transferEnded({
          id,
          onOpen: () =>
            goto(`/dashboard/bridge/transactions?tx=${hashOf(item)}`),
          title: end,
        });
      }
    }
  };
}

/** @returns {() => void} Stops */
export function followArrivals() {
  const stops = [
    routeTransfers.subscribe(
      watcher(
        ({ hash, kind }) => `${kind}:${hash}`,
        ({ hash }) => hash,
        routeTransferEnd
      )
    ),
    depositActivityStore.subscribe(
      watcher(
        (/** @type {any} */ { transactionHash }) =>
          `deposit:${transactionHash}`,
        (/** @type {any} */ { transactionHash }) => transactionHash,
        depositEnd
      )
    ),
    withdrawalActivityStore.subscribe(
      watcher(
        (/** @type {any} */ { transactionHash }) =>
          `withdrawal:${transactionHash}`,
        (/** @type {any} */ { transactionHash }) => transactionHash,
        withdrawalEnd
      )
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
    stopFollowing?.();
    window.removeEventListener("focus", arrivalSeen);
    document.removeEventListener("visibilitychange", arrivalSeen);
    forgetArrivalTitle();
  };
}
