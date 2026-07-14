import { duskEvm } from "$lib/web3/walletConnection";

import {
  normalizedAddress,
  normalizedAmountWei,
  normalizedTxHash,
} from "$lib/bridge/withdrawalActivityValues";

const ACTIVITY_STORAGE_KEY = "dusk-evm:withdrawal-activity:v1";
const LEGACY_LAST_WITHDRAWAL_KEY = "dusk-evm:last-withdrawal-tx-hash";
const MAX_STORED_ITEMS = 100;

/** @typedef {import("./withdrawalActivityValues").WithdrawalActivityItem} WithdrawalActivityItem */

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
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

    return parsed.filter(
      (item) =>
        normalizedTxHash(item?.transactionHash) !== null &&
        Number(item?.chainId) === duskEvm.id
    );
  } catch {
    return [];
  }
}

/**
 * @param {WithdrawalActivityItem[]} items
 */
function writeRememberedItems(items) {
  storage()?.setItem(
    ACTIVITY_STORAGE_KEY,
    JSON.stringify(items.slice(0, MAX_STORED_ITEMS))
  );
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
    amountWei: null,
    blockNumber: null,
    chainId: duskEvm.id,
    challengePeriodEnd: null,
    createdAt,
    explorerStatus: null,
    l1TransactionHash: null,
    source: "local",
    stage: "submitted",
    timestamp: new Date(createdAt).toISOString(),
    transactionHash: hash,
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
