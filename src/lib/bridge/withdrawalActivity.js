import {
  explorerStatusToStage,
  fetchWithdrawalActivity,
  findWithdrawalsByNonce,
  withdrawalExplorerUrl,
} from "$lib/bridge/blockscoutWithdrawalActivity";
import {
  getRememberedWithdrawalActivity,
  hydrateWithdrawalActivity,
  rememberWithdrawalTransaction,
  updateWithdrawalTransaction,
} from "$lib/bridge/withdrawalActivityStorage";
import {
  MAX_ACTIVITY_ITEMS,
  normalizedAddress,
} from "$lib/bridge/withdrawalActivityValues";
import { errorMessage } from "$lib/dusk/error";

/** @typedef {import("./withdrawalActivityValues").WithdrawalActivityItem} WithdrawalActivityItem */

export {
  explorerStatusToStage,
  fetchWithdrawalActivity,
  withdrawalExplorerUrl,
};
export {
  WITHDRAWAL_TIMELINE_STEPS,
  withdrawalStageLabel,
  withdrawalStageProgress,
} from "$lib/bridge/withdrawalLifecycle";
export {
  getRememberedWithdrawalActivity,
  hydrateWithdrawalActivity,
  rememberWithdrawalTransaction,
};
export {
  recordWithdrawalSubmission,
  refreshWithdrawalTransaction,
  resumeWithdrawalTracking,
  trackWithdrawalTransaction,
  withdrawalActivityStore,
} from "$lib/bridge/withdrawalTracking";

/**
 * @param {WithdrawalActivityItem[]} remembered
 * @param {WithdrawalActivityItem[]} indexed
 */
export function mergeWithdrawalActivity(remembered, indexed) {
  const byHash = new Map();

  for (const item of remembered) {
    byHash.set(item.transactionHash, item);
  }

  for (const item of indexed) {
    const local = byHash.get(item.transactionHash);
    const canonical =
      !local?.withdrawalHash &&
      !local?.pendingAction &&
      local?.stage !== "failed"
        ? {}
        : {
            actionError: local.actionError,
            blockNumber: local.blockNumber,
            claimOverdue: local.claimOverdue,
            lastCheckedAt: local.lastCheckedAt,
            pendingAction: local.pendingAction,
            pendingTransactionHash: local.pendingTransactionHash,
            proofGame: local.proofGame,
            proofRejected: local.proofRejected,
            proofSubmitter: local.proofSubmitter,
            readyAt: local.readyAt,
            readyAtExact: local.readyAtExact,
            stage: local.stage,
            statusMessage: local.statusMessage,
            trackingError: local.trackingError,
            withdrawalHash: local.withdrawalHash,
          };

    byHash.set(item.transactionHash, {
      ...local,
      ...item,
      createdAt: local?.createdAt ?? item.createdAt,
      recipient: item.recipient ?? local?.recipient ?? null,
      ...canonical,
    });
  }

  return [...byHash.values()]
    .sort((left, right) => sentTime(right) - sentTime(left))
    .slice(0, MAX_ACTIVITY_ITEMS);
}

/**
 * When a withdrawal was sent, in milliseconds: its DuskEVM block's time once
 * read, or the time it was first seen.
 *
 * @param {WithdrawalActivityItem} item
 */
export function sentTime(item) {
  const time = Date.parse(item.sentAt ?? item.timestamp ?? "");

  return Number.isNaN(time) ? item.createdAt : time;
}

/**
 * The withdrawals the history knows, newest first: those the account proved
 * or claimed on Dusk, by their hashes and nonces.
 *
 * @param {ActivityRow[]} rows
 * @returns {{ hash: `0x${string}`, nonce: bigint, recipient: string | null }[]}
 */
export function historyWithdrawals(rows) {
  /** @type {Map<string, { hash: `0x${string}`, nonce: bigint, recipient: string | null }>} */
  const known = new Map();

  for (const row of rows) {
    const call = row.bridge;

    if (
      (call?.kind === "prove" || call?.kind === "claim") &&
      call.hash &&
      row.status !== "failed" &&
      !known.has(call.hash.toLowerCase())
    ) {
      const hash = /** @type {`0x${string}`} */ (call.hash.toLowerCase());

      known.set(hash, {
        hash,
        nonce: BigInt(`0x${call.withdrawal}`),
        recipient: call.recipient ?? null,
      });
    }
  }

  return [...known.values()].slice(0, MAX_ACTIVITY_ITEMS);
}

/** How long before the explorer is asked again about a withdrawal it didn't list. */
const LOOKUP_AGAIN_MS = 300_000;

/** @type {Map<string, number>} When each nonce was looked up, by nonce. */
const lookedUp = new Map();

/**
 * The withdrawals kept here, by their hashes. Those kept without whom they
 * pay, as before the history read it, take it from the history.
 *
 * @param {{ hash: `0x${string}`, recipient?: string | null }[]} known
 * @returns {Set<string | null>}
 */
function keptWithdrawals(known) {
  const kept = hydrateWithdrawalActivity();

  for (const { hash, recipient } of known) {
    const item = recipient
      ? kept.find((each) => each.withdrawalHash === hash && !each.recipient)
      : undefined;

    if (item) {
      updateWithdrawalTransaction(item.transactionHash, { recipient });
    }
  }

  return new Set(kept.map((item) => item.withdrawalHash));
}

/**
 * Finds the DuskEVM transactions of the history's withdrawals that aren't
 * remembered here yet, and remembers them for the account that sent them,
 * with the withdrawal's hash, so that the history's account sees them
 * without connecting that account. Those remembered learn whom they pay.
 *
 * @param {{ hash: `0x${string}`, nonce: bigint, recipient?: string | null }[]} known
 * @returns {Promise<WithdrawalActivityItem[]>} Those found
 */
export async function rememberHistoryWithdrawals(known) {
  const remembered = keptWithdrawals(known);
  const now = Date.now();
  const missing = known.filter(
    ({ hash, nonce }) =>
      !remembered.has(hash) &&
      now - (lookedUp.get(String(nonce)) ?? -Infinity) >= LOOKUP_AGAIN_MS
  );

  if (!missing.length) {
    return [];
  }

  // Stamped as the lookup starts, so that another doesn't ask again
  // meanwhile; a lookup that fails is tried again the next time.
  for (const { nonce } of missing) {
    lookedUp.set(String(nonce), now);
  }

  /** @type {Awaited<ReturnType<typeof findWithdrawalsByNonce>>} */
  let found;

  try {
    found = await findWithdrawalsByNonce(missing.map(({ nonce }) => nonce));
  } catch (error) {
    for (const { nonce } of missing) {
      if (lookedUp.get(String(nonce)) === now) {
        lookedUp.delete(String(nonce));
      }
    }

    throw error;
  }

  return missing.flatMap(({ hash, nonce, recipient }) => {
    const item = found.get(String(nonce));
    const kept = item
      ? rememberWithdrawalTransaction(item.transactionHash, {
          account: item.account,
          amountWei: item.amountWei ?? undefined,
          createdAt: item.createdAt,
          recipient,
        })
      : null;

    return kept
      ? [
          updateWithdrawalTransaction(kept.transactionHash, {
            withdrawalHash: hash,
          }) ?? kept,
        ]
      : [];
  });
}

/**
 * @param {string | null | undefined} account
 */
export async function loadWithdrawalActivity(account) {
  const remembered = getRememberedWithdrawalActivity(account);
  const normalizedAccount = normalizedAddress(account);

  if (!normalizedAccount) {
    return { error: null, items: remembered, sourceUnavailable: false };
  }

  try {
    const indexed = await fetchWithdrawalActivity(normalizedAccount);

    return {
      error: null,
      items: mergeWithdrawalActivity(remembered, indexed),
      sourceUnavailable: false,
    };
  } catch (error) {
    return {
      error: errorMessage(error),
      items: remembered,
      sourceUnavailable: true,
    };
  }
}
