import {
  explorerStatusToStage,
  fetchWithdrawalActivity,
  withdrawalExplorerUrl,
} from "$lib/bridge/blockscoutWithdrawalActivity";
import {
  getRememberedWithdrawalActivity,
  hydrateWithdrawalActivity,
  rememberWithdrawalTransaction,
} from "$lib/bridge/withdrawalActivityStorage";
import {
  MAX_ACTIVITY_ITEMS,
  errorMessage,
  normalizedAddress,
} from "$lib/bridge/withdrawalActivityValues";

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
            lastCheckedAt: local.lastCheckedAt,
            pendingAction: local.pendingAction,
            pendingTransactionHash: local.pendingTransactionHash,
            proofSubmitter: local.proofSubmitter,
            readyAt: local.readyAt,
            stage: local.stage,
            statusMessage: local.statusMessage,
            trackingError: local.trackingError,
            withdrawalHash: local.withdrawalHash,
          };

    byHash.set(item.transactionHash, {
      ...local,
      ...item,
      createdAt: local?.createdAt ?? item.createdAt,
      ...canonical,
    });
  }

  return [...byHash.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_ACTIVITY_ITEMS);
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
