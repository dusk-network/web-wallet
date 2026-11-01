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
  rememberedWithdrawals,
  updateWithdrawalTransaction,
} from "$lib/bridge/withdrawalActivityStorage";
import {
  MAX_ACTIVITY_ITEMS,
  normalizedAddress,
} from "$lib/bridge/withdrawalActivityValues";
import { errorMessage } from "$lib/dusk/error";
import { walletDataScope } from "$lib/wallets/dataNames";

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
  rememberedWithdrawals,
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

  for (const { bridge, status } of rows) {
    const hash = bridge?.hash;

    if (hash && bridge?.nonce && status !== "failed" && !known.has(hash)) {
      known.set(hash, {
        hash,
        nonce: BigInt(`0x${bridge.nonce}`),
        recipient: bridge.recipient,
      });
    }
  }

  return [...known.values()].slice(0, MAX_ACTIVITY_ITEMS);
}

/** How long before the explorer is asked again about a withdrawal it didn't list. */
const LOOKUP_AGAIN_MS = 300_000;

/**
 * When each nonce was looked up, by wallet, in its time here, and nonce.
 *
 * @type {Map<string, number>}
 */
const lookedUp = new Map();

/**
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @param {bigint} nonce
 */
const lookupOf = (scope, nonce) => `${scope.owner}\n${nonce}`;

/**
 * The withdrawals kept here, by their hashes. Those kept without whom they
 * pay, as before the history read it, take it from the history.
 *
 * @param {{ hash: `0x${string}`, recipient?: string | null }[]} known
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @returns {Set<string | null>}
 */
function keptWithdrawals(known, scope) {
  const kept = rememberedWithdrawals(scope);

  for (const { hash, recipient } of known) {
    const item = recipient
      ? kept.find((each) => each.withdrawalHash === hash && !each.recipient)
      : undefined;

    if (item) {
      updateWithdrawalTransaction(item.transactionHash, { recipient }, scope);
    }
  }

  return new Set(kept.map((item) => item.withdrawalHash));
}

/**
 * Finds the DuskEVM transactions of the history's withdrawals that aren't
 * remembered here yet, and remembers them for the account that sent them,
 * with the withdrawal's hash, so that the history's account sees them
 * without connecting that account. Those remembered learn whom they pay.
 * They're kept for the wallet whose history it is (`scope`, the one open
 * as this begins), whichever wallet is open once they're found.
 *
 * @param {{ hash: `0x${string}`, nonce: bigint, recipient?: string | null }[]} known
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 * @returns {Promise<WithdrawalActivityItem[]>} Those found
 */
export async function rememberHistoryWithdrawals(
  known,
  scope = walletDataScope()
) {
  const remembered = keptWithdrawals(known, scope);
  const now = Date.now();
  const missing = known.filter(
    ({ hash, nonce }) =>
      !remembered.has(hash) &&
      now - (lookedUp.get(lookupOf(scope, nonce)) ?? -Infinity) >=
        LOOKUP_AGAIN_MS
  );

  if (!missing.length) {
    return [];
  }

  // Stamped as the lookup starts, so that another doesn't ask again
  // meanwhile; a lookup that fails is tried again the next time.
  for (const { nonce } of missing) {
    lookedUp.set(lookupOf(scope, nonce), now);
  }

  /** @type {Awaited<ReturnType<typeof findWithdrawalsByNonce>>} */
  let found;

  try {
    found = await findWithdrawalsByNonce(missing.map(({ nonce }) => nonce));
  } catch (error) {
    for (const { nonce } of missing) {
      if (lookedUp.get(lookupOf(scope, nonce)) === now) {
        lookedUp.delete(lookupOf(scope, nonce));
      }
    }

    throw error;
  }

  return keepFound(missing, found, scope);
}

/**
 * Keeps the withdrawals the explorer found by their nonces, each with the
 * withdrawal's hash and whom it pays, for the wallet whose history it is.
 *
 * @param {{ hash: `0x${string}`, nonce: bigint, recipient?: string | null }[]} missing
 * @param {Awaited<ReturnType<typeof findWithdrawalsByNonce>>} found
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @returns {WithdrawalActivityItem[]}
 */
function keepFound(missing, found, scope) {
  return missing.flatMap(({ hash, nonce, recipient }) => {
    const item = found.get(String(nonce));
    const kept = item
      ? rememberWithdrawalTransaction(
          item.transactionHash,
          {
            account: item.account,
            amountWei: item.amountWei ?? undefined,
            createdAt: item.createdAt,
            recipient,
          },
          scope
        )
      : null;

    return kept
      ? [
          updateWithdrawalTransaction(
            kept.transactionHash,
            { withdrawalHash: hash },
            scope
          ) ?? kept,
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
