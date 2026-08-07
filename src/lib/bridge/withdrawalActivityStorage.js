import { writable } from "svelte/store";

import { duskEvm } from "$lib/web3/walletConnection";

import {
  normalizedAddress,
  normalizedAmountWei,
  normalizedDuskTxHash,
  normalizedTimestamp,
  normalizedTxHash,
  stringValue,
} from "$lib/bridge/withdrawalActivityValues";

const ACTIVITY_STORAGE_KEY = "dusk-evm:withdrawal-activity:v1";
const LEGACY_LAST_WITHDRAWAL_KEY = "dusk-evm:last-withdrawal-tx-hash";
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

/** @type {import("svelte/store").Writable<WithdrawalActivityItem[]>} */
const activity = writable([]);

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
    challengePeriodEnd: normalizedTimestamp(stored.challengePeriodEnd),
    createdAt,
    explorerStatus: stringValue(stored.explorerStatus),
    l1TransactionHash: normalizedTxHash(stored.l1TransactionHash),
    lastCheckedAt: finiteNumber(stored.lastCheckedAt, 0) || null,
    pendingAction: validPendingAction(stored.pendingAction),
    pendingTransactionHash: normalizedDuskTxHash(stored.pendingTransactionHash),
    proofSubmitter: normalizedAddress(stored.proofSubmitter),
    readyAt: stringValue(stored.readyAt),
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
 * @returns {WithdrawalActivityItem[]}
 */
function readRememberedItems() {
  const localStorage = storage();

  if (!localStorage) {
    return [];
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? "[]"
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeStoredItem).filter((item) => item !== null);
  } catch {
    return [];
  }
}

/**
 * @param {WithdrawalActivityItem[]} items
 */
function writeRememberedItems(items) {
  const stored = items.slice(0, MAX_STORED_ITEMS);
  storage()?.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(stored));
  activity.set(stored);
}

export function hydrateWithdrawalActivity() {
  const items = readRememberedItems();
  activity.set(items);
  return items;
}

/**
 * @param {`0x${string}`} transactionHash
 * @param {{ account?: string | null, amountWei?: bigint | string, createdAt?: number }} [options]
 */
export function rememberWithdrawalTransaction(transactionHash, options = {}) {
  const hash = normalizedTxHash(transactionHash);

  if (!hash) {
    return null;
  }

  const storedItems = readRememberedItems();
  const existing = storedItems.find((item) => item.transactionHash === hash);
  const createdAt = options.createdAt ?? existing?.createdAt ?? Date.now();
  const remembered = storedItems.filter(
    (item) => item.transactionHash !== hash
  );
  const defaults = /** @type {WithdrawalActivityItem} */ ({
    account: null,
    actionError: null,
    amountWei: null,
    blockNumber: null,
    chainId: duskEvm.id,
    challengePeriodEnd: null,
    createdAt,
    explorerStatus: null,
    l1TransactionHash: null,
    lastCheckedAt: null,
    pendingAction: null,
    pendingTransactionHash: null,
    proofSubmitter: null,
    readyAt: null,
    source: "local",
    stage: "submitted",
    statusMessage: null,
    timestamp: new Date(createdAt).toISOString(),
    trackingError: null,
    transactionHash: hash,
    withdrawalHash: null,
  });
  const item = /** @type {WithdrawalActivityItem} */ ({
    ...defaults,
    ...existing,
    account: normalizedAddress(options.account) ?? existing?.account ?? null,
    amountWei:
      normalizedAmountWei(options.amountWei) ?? existing?.amountWei ?? null,
    chainId: duskEvm.id,
    createdAt,
    source: "local",
    transactionHash: hash,
  });

  writeRememberedItems([item, ...remembered]);
  storage()?.setItem(LEGACY_LAST_WITHDRAWAL_KEY, hash);

  return item;
}

/**
 * @param {string} transactionHash
 * @param {Partial<WithdrawalActivityItem>} patch
 */
export function updateWithdrawalTransaction(transactionHash, patch) {
  const hash = normalizedTxHash(transactionHash);

  if (!hash) return null;

  const storedItems = readRememberedItems();
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
    source: existing.source,
    stage: VALID_STAGES.has(patch.stage ?? "") ? patch.stage : existing.stage,
    timestamp: existing.timestamp,
    transactionHash: hash,
  });

  if (!item) return null;

  writeRememberedItems([
    item,
    ...storedItems.filter((candidate) => candidate.transactionHash !== hash),
  ]);

  return item;
}

/** @param {string} transactionHash */
export function getRememberedWithdrawalTransaction(transactionHash) {
  const hash = normalizedTxHash(transactionHash);

  return hash
    ? (readRememberedItems().find((item) => item.transactionHash === hash) ??
        null)
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
