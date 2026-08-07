import { writable } from "svelte/store";

import { duskEvm } from "$lib/web3/walletConnection";
import {
  normalizedAddress,
  normalizedAmountWei,
  normalizedDuskTxHash,
  normalizedTxHash,
  stringValue,
} from "$lib/bridge/withdrawalActivityValues";

import { isDepositTerminal } from "$lib/bridge/depositLifecycle";

const ACTIVITY_STORAGE_KEY = "dusk-evm:deposit-activity:v1";
const MAX_STORED_ITEMS = 100;
const VALID_STAGES = new Set([
  "l1_pending",
  "l2_pending",
  "completed",
  "failed",
]);

/**
 * @typedef {object} DepositActivityItem
 * @property {string | null} account
 * @property {string | null} amountLux
 * @property {string | null} amountWei
 * @property {number} chainId
 * @property {number} createdAt
 * @property {"l1" | "l2" | null} failureLayer
 * @property {number | null} l1ConfirmedAt
 * @property {string | null} l1BlockHeight
 * @property {`0x${string}` | null} l1TransactionHash
 * @property {string | null} l2BlockNumber
 * @property {`0x${string}` | null} l2TransactionHash
 * @property {number | null} lastCheckedAt
 * @property {number} progressedAt
 * @property {string} stage
 * @property {string | null} statusMessage
 * @property {string | null} trackingError
 * @property {string} transactionHash Native Dusk transaction ID.
 * @property {number} updatedAt
 */

/** @type {import("svelte/store").Writable<DepositActivityItem[]>} */
const activity = writable([]);

export const depositActivityStore = { subscribe: activity.subscribe };

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function validStage(value) {
  return typeof value === "string" && VALID_STAGES.has(value)
    ? value
    : "l1_pending";
}

/** @param {unknown} value */
function validFailureLayer(value) {
  return value === "l1" || value === "l2" ? value : null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @param {string | null} fallback
 */
function nullableStringPatch(value, fallback) {
  return value === null ? null : (stringValue(value) ?? fallback);
}

/**
 * @param {unknown} value
 * @param {`0x${string}` | null} fallback
 */
function nullableTransactionHashPatch(value, fallback) {
  return value === null ? null : (normalizedTxHash(value) ?? fallback);
}

/** @param {any} value */
function normalizeStoredItem(value) {
  const stored = value && typeof value === "object" ? value : {};
  const transactionHash = normalizedDuskTxHash(stored.transactionHash);

  if (!transactionHash || Number(stored.chainId) !== duskEvm.id) return null;

  const createdAt = finiteNumber(stored.createdAt, Date.now());

  return /** @type {DepositActivityItem} */ ({
    account: normalizedAddress(stored.account),
    amountLux: normalizedAmountWei(stored.amountLux),
    amountWei: normalizedAmountWei(stored.amountWei),
    chainId: duskEvm.id,
    createdAt,
    failureLayer: validFailureLayer(stored.failureLayer),
    l1BlockHeight: stringValue(stored.l1BlockHeight),
    l1ConfirmedAt: finiteNumber(stored.l1ConfirmedAt, 0) || null,
    l1TransactionHash: normalizedTxHash(stored.l1TransactionHash),
    l2BlockNumber: stringValue(stored.l2BlockNumber),
    l2TransactionHash: normalizedTxHash(stored.l2TransactionHash),
    lastCheckedAt: finiteNumber(stored.lastCheckedAt, 0) || null,
    progressedAt: finiteNumber(stored.progressedAt, createdAt),
    stage: validStage(stored.stage),
    statusMessage: stringValue(stored.statusMessage),
    trackingError: stringValue(stored.trackingError),
    transactionHash,
    updatedAt: finiteNumber(stored.updatedAt, createdAt),
  });
}

/** @returns {DepositActivityItem[]} */
function readRememberedItems() {
  const localStorage = storage();

  if (!localStorage) return [];

  try {
    const parsed = JSON.parse(
      localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? "[]"
    );

    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeStoredItem).filter((item) => item !== null);
  } catch {
    return [];
  }
}

/** @param {DepositActivityItem[]} items */
function writeRememberedItems(items) {
  const stored = items.slice(0, MAX_STORED_ITEMS);
  storage()?.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(stored));
  activity.set(stored);
}

export function hydrateDepositActivity() {
  const items = readRememberedItems();
  activity.set(items);
  return items;
}

/**
 * @param {string} transactionHash
 * @param {{ account?: string | null, amountLux?: bigint | string, amountWei?: bigint | string, createdAt?: number }} [options]
 */
export function rememberDepositTransaction(transactionHash, options = {}) {
  const hash = normalizedDuskTxHash(transactionHash);

  if (!hash) return null;

  const storedItems = readRememberedItems();
  const existing = storedItems.find((item) => item.transactionHash === hash);
  const createdAt = options.createdAt ?? existing?.createdAt ?? Date.now();
  const base =
    existing ??
    /** @type {DepositActivityItem} */ ({
      account: null,
      amountLux: null,
      amountWei: null,
      chainId: duskEvm.id,
      createdAt,
      failureLayer: null,
      l1BlockHeight: null,
      l1ConfirmedAt: null,
      l1TransactionHash: null,
      l2BlockNumber: null,
      l2TransactionHash: null,
      lastCheckedAt: null,
      progressedAt: createdAt,
      stage: "l1_pending",
      statusMessage: null,
      trackingError: null,
      transactionHash: hash,
      updatedAt: createdAt,
    });
  const item = /** @type {DepositActivityItem} */ ({
    ...base,
    account: normalizedAddress(options.account) ?? base.account,
    amountLux: normalizedAmountWei(options.amountLux) ?? base.amountLux,
    amountWei: normalizedAmountWei(options.amountWei) ?? base.amountWei,
    chainId: duskEvm.id,
    createdAt,
    transactionHash: hash,
  });

  writeRememberedItems([
    item,
    ...storedItems.filter((candidate) => candidate.transactionHash !== hash),
  ]);

  return item;
}

/**
 * @param {DepositActivityItem} existing
 * @param {Partial<DepositActivityItem>} patch
 * @param {string} nextStage
 * @param {`0x${string}` | null} nextL1TransactionHash
 * @param {`0x${string}` | null} nextL2TransactionHash
 */
function nextProgressedAt(
  existing,
  patch,
  nextStage,
  nextL1TransactionHash,
  nextL2TransactionHash
) {
  const progressed =
    nextStage !== existing.stage ||
    nextL1TransactionHash !== existing.l1TransactionHash ||
    nextL2TransactionHash !== existing.l2TransactionHash;

  return finiteNumber(
    patch.progressedAt,
    progressed ? Date.now() : existing.progressedAt
  );
}

/**
 * @param {string} transactionHash
 * @param {Partial<DepositActivityItem>} patch
 */
export function updateDepositTransaction(transactionHash, patch) {
  const hash = normalizedDuskTxHash(transactionHash);

  if (!hash) return null;

  const storedItems = readRememberedItems();
  const existing = storedItems.find((item) => item.transactionHash === hash);

  if (!existing) return null;

  const nextStage =
    typeof patch.stage === "string" && VALID_STAGES.has(patch.stage)
      ? patch.stage
      : existing.stage;
  const nextL1TransactionHash = nullableTransactionHashPatch(
    patch.l1TransactionHash,
    existing.l1TransactionHash
  );
  const nextL2TransactionHash =
    normalizedTxHash(patch.l2TransactionHash) ?? existing.l2TransactionHash;
  const item = /** @type {DepositActivityItem} */ ({
    ...existing,
    ...patch,
    account: normalizedAddress(patch.account) ?? existing.account,
    amountLux: normalizedAmountWei(patch.amountLux) ?? existing.amountLux,
    amountWei: normalizedAmountWei(patch.amountWei) ?? existing.amountWei,
    chainId: duskEvm.id,
    failureLayer:
      patch.failureLayer === "l1" || patch.failureLayer === "l2"
        ? patch.failureLayer
        : patch.failureLayer === null
          ? null
          : existing.failureLayer,
    l1BlockHeight: nullableStringPatch(
      patch.l1BlockHeight,
      existing.l1BlockHeight
    ),
    l1TransactionHash: nextL1TransactionHash,
    l2BlockNumber: nullableStringPatch(
      patch.l2BlockNumber,
      existing.l2BlockNumber
    ),
    l2TransactionHash: nextL2TransactionHash,
    progressedAt: nextProgressedAt(
      existing,
      patch,
      nextStage,
      nextL1TransactionHash,
      nextL2TransactionHash
    ),
    stage: nextStage,
    transactionHash: hash,
  });

  writeRememberedItems([
    item,
    ...storedItems.filter((candidate) => candidate.transactionHash !== hash),
  ]);

  return item;
}

/** @param {string | null | undefined} account */
export function getRememberedDepositActivity(account) {
  const normalizedAccount = normalizedAddress(account);

  return readRememberedItems().filter(
    (item) =>
      item.account === null ||
      (normalizedAccount !== null && item.account === normalizedAccount)
  );
}

/** @param {string} transactionHash */
export function getRememberedDepositTransaction(transactionHash) {
  const hash = normalizedDuskTxHash(transactionHash);
  return hash
    ? (readRememberedItems().find((item) => item.transactionHash === hash) ??
        null)
    : null;
}

/**
 * @param {string | null | undefined} account
 * @param {DepositActivityItem[]} [items]
 */
export function pendingDepositAmountLux(
  account,
  items = readRememberedItems()
) {
  const normalizedAccount = normalizedAddress(account);

  return items.reduce((total, item) => {
    if (
      isDepositTerminal(item) ||
      !item.amountLux ||
      (item.account !== null && item.account !== normalizedAccount)
    ) {
      return total;
    }

    return total + BigInt(item.amountLux);
  }, 0n);
}
