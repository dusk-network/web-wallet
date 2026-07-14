import { duskEvm } from "$lib/web3/walletConnection";
import { toFunctionSelector } from "viem";

const ACTIVITY_STORAGE_KEY = "dusk-evm:withdrawal-activity:v1";
const LEGACY_LAST_WITHDRAWAL_KEY = "dusk-evm:last-withdrawal-tx-hash";
const MAX_ACTIVITY_ITEMS = 12;
const MAX_STORED_ITEMS = 100;
const MAX_TRANSACTION_PAGES = 10;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const NATIVE_WITHDRAWAL_SELECTOR = toFunctionSelector(
  "bridgeETHTo(address,uint32,bytes)"
);

/**
 * @typedef {object} WithdrawalActivityItem
 * @property {string | null} account
 * @property {string | null} amountWei
 * @property {string | null} blockNumber
 * @property {string | null} challengePeriodEnd
 * @property {number} chainId
 * @property {number} createdAt
 * @property {string | null} explorerStatus
 * @property {string | null} l1TransactionHash
 * @property {"explorer" | "local"} source
 * @property {string} stage
 * @property {string | null} timestamp
 * @property {`0x${string}`} transactionHash
 */

/**
 * @param {unknown} value
 */
function errorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}

/**
 * @param {unknown} value
 */
function addressHash(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "hash" in value) {
    return typeof value.hash === "string" ? value.hash : null;
  }

  return null;
}

/**
 * @param {unknown} value
 */
function normalizedAddress(value) {
  const hash = addressHash(value);

  return hash && EVM_ADDRESS_PATTERN.test(hash) ? hash.toLowerCase() : null;
}

/**
 * @param {unknown} value
 * @returns {`0x${string}` | null}
 */
function normalizedTxHash(value) {
  return typeof value === "string" && TX_HASH_PATTERN.test(value)
    ? /** @type {`0x${string}`} */ (value.toLowerCase())
    : null;
}

/**
 * @param {unknown} value
 */
function normalizedTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {unknown} value
 */
function stringValue(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

/**
 * @param {unknown} value
 */
function normalizedAmountWei(value) {
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }

  return typeof value === "string" && /^\d+$/u.test(value) ? value : null;
}

/**
 * @param {string | null | undefined} status
 */
export function explorerStatusToStage(status) {
  switch (status?.trim().toLowerCase()) {
    case "waiting for state root":
      return "waiting_for_output";
    case "ready to prove":
      return "ready_to_prove";
    case "waiting a game to resolve":
    case "in challenge period":
    case "proven":
      return "proven_waiting";
    case "ready for relay":
      return "ready_to_finalize";
    case "relayed":
      return "finalized";
    default:
      return "submitted";
  }
}

/**
 * @param {string} stage
 */
export function withdrawalStageLabel(stage) {
  switch (stage) {
    case "submitted":
      return "Confirming";
    case "waiting_for_output":
      return "Waiting for output";
    case "ready_to_prove":
      return "Ready to prove";
    case "prove_submitted":
      return "Proof submitted";
    case "proven_waiting":
      return "Challenge period";
    case "ready_to_finalize":
      return "Ready to finalize";
    case "finalize_submitted":
      return "Finalization submitted";
    case "finalized":
      return "Finalized";
    default:
      return "Status unavailable";
  }
}

/**
 * @param {string} stage
 */
export function withdrawalStageProgress(stage) {
  switch (stage) {
    case "waiting_for_output":
      return 1;
    case "ready_to_prove":
    case "prove_submitted":
      return 2;
    case "proven_waiting":
      return 3;
    case "ready_to_finalize":
    case "finalize_submitted":
      return 4;
    case "finalized":
      return 5;
    default:
      return 0;
  }
}

function explorerBaseUrl() {
  const baseUrl = duskEvm.blockExplorers?.default?.url;

  return typeof baseUrl === "string" && baseUrl.trim()
    ? baseUrl.replace(/\/$/u, "")
    : null;
}

/**
 * @param {string} txHash
 */
export function withdrawalExplorerUrl(txHash) {
  const baseUrl = explorerBaseUrl();

  return baseUrl && normalizedTxHash(txHash) ? `${baseUrl}/tx/${txHash}` : null;
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} [params]
 */
function explorerApiUrl(path, params = {}) {
  const baseUrl = explorerBaseUrl();

  if (!baseUrl) {
    throw new Error("The DuskEVM block explorer is not configured.");
  }

  const url = new URL(`${baseUrl}/api/v2/${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

/**
 * @param {URL} url
 */
async function fetchExplorerJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Blockscout request failed with HTTP ${response.status}.`);
  }

  return await response.json();
}

function bridgeAddress() {
  return normalizedAddress(duskEvm.contracts?.L2StandardBridge?.address);
}

/**
 * @param {any} transaction
 * @param {string} account
 * @param {string} configuredBridgeAddress
 */
function isWithdrawalCandidate(transaction, account, configuredBridgeAddress) {
  return (
    normalizedTxHash(transaction?.hash) !== null &&
    normalizedAddress(transaction?.from) === account &&
    normalizedAddress(transaction?.to) === configuredBridgeAddress &&
    isNativeWithdrawalCall(transaction) &&
    transaction?.status !== "error"
  );
}

/**
 * @param {any} transaction
 */
function isNativeWithdrawalCall(transaction) {
  const input =
    typeof transaction?.raw_input === "string"
      ? transaction.raw_input
      : transaction?.input;

  if (typeof input === "string" && input.length >= 10) {
    return input.slice(0, 10).toLowerCase() === NATIVE_WITHDRAWAL_SELECTOR;
  }

  return transaction?.method === "bridgeETHTo";
}

/**
 * @param {any} transaction
 */
function localItemFromTransaction(transaction) {
  const transactionHash = normalizedTxHash(transaction?.hash);

  if (!transactionHash) {
    return null;
  }

  const timestamp = normalizedTimestamp(transaction?.timestamp);

  return /** @type {WithdrawalActivityItem} */ ({
    account: normalizedAddress(transaction?.from),
    amountWei: stringValue(transaction?.value),
    blockNumber: stringValue(transaction?.block_number),
    chainId: duskEvm.id,
    challengePeriodEnd: null,
    createdAt: timestamp ? new Date(timestamp).getTime() : Date.now(),
    explorerStatus: null,
    l1TransactionHash: null,
    source: "explorer",
    stage: "submitted",
    timestamp,
    transactionHash,
  });
}

/**
 * @param {any} transaction
 */
function activityItemFromTransaction(transaction) {
  const fallback = localItemFromTransaction(transaction);

  if (!fallback) {
    return null;
  }

  const withdrawal = Array.isArray(transaction?.op_withdrawals)
    ? transaction.op_withdrawals[0]
    : null;
  const explorerStatus =
    typeof withdrawal?.status === "string" ? withdrawal.status : null;
  const timestamp =
    normalizedTimestamp(withdrawal?.l2_timestamp) ?? fallback.timestamp;

  return /** @type {WithdrawalActivityItem} */ ({
    ...fallback,
    amountWei:
      stringValue(withdrawal?.msg_value) ?? stringValue(transaction?.value),
    challengePeriodEnd: normalizedTimestamp(withdrawal?.challenge_period_end),
    createdAt: timestamp ? new Date(timestamp).getTime() : fallback.createdAt,
    explorerStatus,
    l1TransactionHash: normalizedTxHash(withdrawal?.l1_transaction_hash),
    stage: explorerStatusToStage(explorerStatus),
    timestamp,
  });
}

/**
 * @param {any[]} transactions
 * @param {string} account
 * @param {string} configuredBridgeAddress
 */
function withdrawalCandidates(transactions, account, configuredBridgeAddress) {
  return transactions.filter((transaction) =>
    isWithdrawalCandidate(transaction, account, configuredBridgeAddress)
  );
}

/**
 * @param {string} account
 */
async function fetchCandidateTransactions(account) {
  const configuredBridgeAddress = bridgeAddress();

  if (!configuredBridgeAddress) {
    throw new Error("The DuskEVM bridge contract is not configured.");
  }

  /** @type {any[]} */
  const candidates = [];
  /** @type {Record<string, unknown>} */
  let pageParams = { filter: "from" };

  for (let page = 0; page < MAX_TRANSACTION_PAGES; page += 1) {
    const body = await fetchExplorerJson(
      explorerApiUrl(`addresses/${account}/transactions`, pageParams)
    );
    const transactions = Array.isArray(body?.items) ? body.items : [];

    candidates.push(
      ...withdrawalCandidates(transactions, account, configuredBridgeAddress)
    );

    if (
      candidates.length >= MAX_ACTIVITY_ITEMS ||
      !body?.next_page_params ||
      transactions.length === 0
    ) {
      break;
    }

    pageParams = { ...body.next_page_params, filter: "from" };
  }

  return candidates.slice(0, MAX_ACTIVITY_ITEMS);
}

/**
 * @param {any} transaction
 */
async function fetchCandidateDetails(transaction) {
  const transactionHash = normalizedTxHash(transaction?.hash);

  if (!transactionHash) {
    return null;
  }

  try {
    const details = await fetchExplorerJson(
      explorerApiUrl(`transactions/${transactionHash}`)
    );

    return activityItemFromTransaction(details);
  } catch {
    return localItemFromTransaction(transaction);
  }
}

/**
 * @param {string} account
 */
export async function fetchWithdrawalActivity(account) {
  const normalizedAccount = normalizedAddress(account);

  if (!normalizedAccount) {
    throw new Error("Connect a valid DuskEVM account to load activity.");
  }

  const candidates = await fetchCandidateTransactions(normalizedAccount);
  const items = await Promise.all(candidates.map(fetchCandidateDetails));

  return items.filter(
    /** @returns {item is WithdrawalActivityItem} */
    (item) => item !== null
  );
}

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

  if (!normalizedAddress(account)) {
    return { error: null, items: remembered, sourceUnavailable: false };
  }

  try {
    const indexed = await fetchWithdrawalActivity(
      /** @type {string} */ (account)
    );

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
