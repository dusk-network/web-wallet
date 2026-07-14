import {
  explorerStatusToStage,
  fetchWithdrawalActivity,
  withdrawalExplorerUrl,
} from "$lib/bridge/blockscoutWithdrawalActivity";
import {
  getRememberedWithdrawalActivity,
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
export { getRememberedWithdrawalActivity, rememberWithdrawalTransaction };

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

    byHash.set(item.transactionHash, {
      ...local,
      ...item,
      createdAt: local?.createdAt ?? item.createdAt,
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
