import { writable } from "svelte/store";

import { duskEvm } from "$lib/web3/walletConnection";

import {
  normalizedAddress,
  normalizedAmountWei,
  normalizedDuskRecipient,
  normalizedDuskTxHash,
  normalizedTimestamp,
  normalizedTxHash,
  stringValue,
} from "$lib/bridge/withdrawalActivityValues";
import {
  WITHDRAWAL_ACTIVITY_KEY as ACTIVITY_STORAGE_KEY,
  LAST_WITHDRAWAL_KEY as LEGACY_LAST_WITHDRAWAL_KEY,
} from "$lib/bridge/bridgeRecordKeys";
import { walletDataName, walletDataScope } from "$lib/wallets/dataNames";
import { changeRecords, recordsOf } from "$lib/wallets/walletRecords";

/**
 * Each wallet's withdrawals are kept under its own name: work that writes
 * them after it waits takes its wallet's as it begins (`scope`), and keeps
 * them there whichever wallet is open by then ($lib/wallets/walletRecords).
 *
 * @typedef {import("$lib/wallets/dataNames").WalletDataScope} WalletDataScope
 */

const MAX_STORED_ITEMS = 100;
const VALID_STAGES = new Set([
  "submitted",
  "waiting_for_output",
  "ready_to_prove",
  "prove_submitted",
  "proven_waiting",
  "ready_to_finalize",
  "finalize_submitted",
  "finalized",
  "failed",
]);

/** @typedef {import("./withdrawalActivityValues").WithdrawalActivityItem} WithdrawalActivityItem */

const activity = writable(/** @type {WithdrawalActivityItem[]} */ ([]));

export const withdrawalActivityStore = { subscribe: activity.subscribe };

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value */
function validStage(value) {
  return typeof value === "string" && VALID_STAGES.has(value)
    ? value
    : "submitted";
}

/** @param {unknown} value */
function validPendingAction(value) {
  return value === "prove" || value === "finalize" ? value : null;
}

/** @param {any} value */
function normalizeStoredItem(value) {
  const stored = value && typeof value === "object" ? value : {};
  const transactionHash = normalizedTxHash(stored.transactionHash);

  if (!transactionHash || Number(stored.chainId) !== duskEvm.id) {
    return null;
  }

  const createdAt = finiteNumber(stored.createdAt, Date.now());

  return /** @type {WithdrawalActivityItem} */ ({
    account: normalizedAddress(stored.account),
    actionError: stringValue(stored.actionError),
    amountWei: normalizedAmountWei(stored.amountWei),
    blockNumber: stringValue(stored.blockNumber),
    chainId: duskEvm.id,
    claimOverdue: stored.claimOverdue === true,
    createdAt,
    explorerStatus: stringValue(stored.explorerStatus),
    l1TransactionHash: normalizedTxHash(stored.l1TransactionHash),
    lastCheckedAt: finiteNumber(stored.lastCheckedAt, 0) || null,
    pendingAction: validPendingAction(stored.pendingAction),
    pendingTransactionHash: normalizedDuskTxHash(stored.pendingTransactionHash),
    proofGame: normalizedAddress(stored.proofGame),
    proofRejected: stored.proofRejected === true,
    proofSubmitter: normalizedAddress(stored.proofSubmitter),
    readyAt: stringValue(stored.readyAt),
    readyAtExact: stored.readyAtExact === true,
    recipient: normalizedDuskRecipient(stored.recipient),
    sentAt: normalizedTimestamp(stored.sentAt),
    source: stored.source === "explorer" ? "explorer" : "local",
    stage: validStage(stored.stage),
    statusMessage: stringValue(stored.statusMessage),
    timestamp:
      normalizedTimestamp(stored.timestamp) ??
      new Date(createdAt).toISOString(),
    trackingError: stringValue(stored.trackingError),
    transactionHash,
    withdrawalHash: normalizedTxHash(stored.withdrawalHash),
  });
}

/**
 * @param {WalletDataScope} scope
 * @returns {WithdrawalActivityItem[]}
 */
function readStoredItems(scope) {
  const localStorage = storage();

  if (!localStorage) {
    return [];
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(scope.name(ACTIVITY_STORAGE_KEY)) ?? "[]"
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeStoredItem).filter((item) => item !== null);
  } catch {
    return [];
  }
}

/** A wallet's withdrawals ($lib/wallets/walletRecords). */
const withdrawals = {
  name: ACTIVITY_STORAGE_KEY,
  read: readStoredItems,
  store: activity,
};

/**
 * A wallet's withdrawals: the open one's as shown, another's as kept.
 *
 * @param {WalletDataScope} [scope]
 * @returns {WithdrawalActivityItem[]}
 */
const readRememberedItems = (scope = walletDataScope()) =>
  recordsOf(withdrawals, scope);

/**
 * @param {WithdrawalActivityItem[]} items
 * @param {WalletDataScope} scope
 */
const writeRememberedItems = (items, scope) =>
  changeRecords(withdrawals, scope, () => items.slice(0, MAX_STORED_ITEMS));

/** Forgets every withdrawal kept here, as Reset does. */
export function forgetWithdrawalActivity() {
  storage()?.removeItem(walletDataName(ACTIVITY_STORAGE_KEY));
  storage()?.removeItem(walletDataName(LEGACY_LAST_WITHDRAWAL_KEY));
  activity.set([]);
}

/** Reads the open wallet's withdrawals, as it opens. */
export function hydrateWithdrawalActivity() {
  const items = readStoredItems(walletDataScope());

  activity.set(items);
  return items;
}

/**
 * The withdrawals a wallet keeps: the open one's by default, as shown.
 *
 * @param {WalletDataScope} [scope]
 */
export const rememberedWithdrawals = (scope) => readRememberedItems(scope);

/**
 * Whom a withdrawal pays on Dusk: as now said, else as said before.
 *
 * @param {unknown} said
 * @param {WithdrawalActivityItem | undefined} existing
 */
const recipientOf = (said, existing) =>
  normalizedDuskRecipient(said) ?? existing?.recipient ?? null;

/**
 * A withdrawal as it's kept: what was kept of it before, with what's said
 * now.
 *
 * @param {`0x${string}`} hash
 * @param {{ account?: string | null, amountWei?: bigint | string, createdAt?: number, recipient?: string | null }} options
 * @param {WithdrawalActivityItem | undefined} existing
 * @returns {WithdrawalActivityItem}
 */
function withdrawalItem(hash, options, existing) {
  const createdAt = options.createdAt ?? existing?.createdAt ?? Date.now();
  const defaults = /** @type {WithdrawalActivityItem} */ ({
    account: null,
    actionError: null,
    amountWei: null,
    blockNumber: null,
    chainId: duskEvm.id,
    claimOverdue: false,
    createdAt,
    explorerStatus: null,
    l1TransactionHash: null,
    lastCheckedAt: null,
    pendingAction: null,
    pendingTransactionHash: null,
    proofGame: null,
    proofRejected: false,
    proofSubmitter: null,
    readyAt: null,
    readyAtExact: false,
    recipient: null,
    sentAt: null,
    source: "local",
    stage: "submitted",
    statusMessage: null,
    timestamp: new Date(createdAt).toISOString(),
    trackingError: null,
    transactionHash: hash,
    withdrawalHash: null,
  });

  return /** @type {WithdrawalActivityItem} */ ({
    ...defaults,
    ...existing,
    account: normalizedAddress(options.account) ?? existing?.account ?? null,
    amountWei:
      normalizedAmountWei(options.amountWei) ?? existing?.amountWei ?? null,
    chainId: duskEvm.id,
    createdAt,
    recipient: recipientOf(options.recipient, existing),
    source: "local",
    transactionHash: hash,
  });
}

/**
 * @param {`0x${string}`} transactionHash
 * @param {{ account?: string | null, amountWei?: bigint | string, createdAt?: number, recipient?: string | null }} [options]
 *   `recipient` whom it pays on Dusk, where that's known
 * @param {WalletDataScope} [scope] The wallet it's kept for: the open one
 *   by default
 */
export function rememberWithdrawalTransaction(
  transactionHash,
  options = {},
  scope = walletDataScope()
) {
  const hash = normalizedTxHash(transactionHash);

  if (!hash || !scope.keeps()) {
    return null;
  }

  const storedItems = readRememberedItems(scope);
  const existing = storedItems.find((item) => item.transactionHash === hash);
  const item = withdrawalItem(hash, options, existing);

  writeRememberedItems(
    [item, ...storedItems.filter((each) => each.transactionHash !== hash)],
    scope
  );
  try {
    storage()?.setItem(scope.name(LEGACY_LAST_WITHDRAWAL_KEY), hash);
  } catch {
    // Kept in this tab only.
  }

  return item;
}

/**
 * @param {string} transactionHash
 * @param {Partial<WithdrawalActivityItem>} patch
 * @param {WalletDataScope} [scope] The wallet it's kept for: the open one
 *   by default
 */
export function updateWithdrawalTransaction(
  transactionHash,
  patch,
  scope = walletDataScope()
) {
  const hash = normalizedTxHash(transactionHash);

  if (!hash || !scope.keeps()) return null;

  const storedItems = readRememberedItems(scope);
  const existing = storedItems.find((item) => item.transactionHash === hash);

  if (!existing) return null;

  const item = normalizeStoredItem({
    ...existing,
    ...patch,
    account: normalizedAddress(patch.account) ?? existing.account,
    amountWei: normalizedAmountWei(patch.amountWei) ?? existing.amountWei,
    chainId: duskEvm.id,
    createdAt: existing.createdAt,
    pendingAction:
      patch.pendingAction === null
        ? null
        : (validPendingAction(patch.pendingAction) ?? existing.pendingAction),
    pendingTransactionHash:
      patch.pendingTransactionHash === null
        ? null
        : (normalizedDuskTxHash(patch.pendingTransactionHash) ??
          existing.pendingTransactionHash),
    recipient: recipientOf(patch.recipient, existing),
    source: existing.source,
    stage: VALID_STAGES.has(patch.stage ?? "") ? patch.stage : existing.stage,
    timestamp: existing.timestamp,
    transactionHash: hash,
  });

  if (!item) return null;

  writeRememberedItems(
    [
      item,
      ...storedItems.filter((candidate) => candidate.transactionHash !== hash),
    ],
    scope
  );

  return item;
}

/**
 * @param {string} transactionHash
 * @param {WalletDataScope} [scope] Whose: the open wallet's by default
 */
export function getRememberedWithdrawalTransaction(
  transactionHash,
  scope = walletDataScope()
) {
  const hash = normalizedTxHash(transactionHash);

  return hash
    ? (readRememberedItems(scope).find(
        (item) => item.transactionHash === hash
      ) ?? null)
    : null;
}

/**
 * @param {string | null | undefined} account
 */
export function getRememberedWithdrawalActivity(account) {
  const normalizedAccount = normalizedAddress(account);

  return readRememberedItems().filter(
    (item) =>
      item.account === null ||
      (normalizedAccount !== null && item.account === normalizedAccount)
  );
}
