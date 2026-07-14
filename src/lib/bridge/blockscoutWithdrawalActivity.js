import { duskEvm } from "$lib/web3/walletConnection";
import { toFunctionSelector } from "viem";

import {
  MAX_ACTIVITY_ITEMS,
  normalizedAddress,
  normalizedTimestamp,
  normalizedTxHash,
  stringValue,
} from "$lib/bridge/withdrawalActivityValues";

const MAX_TRANSACTION_PAGES = 10;
const NATIVE_WITHDRAWAL_SELECTOR = toFunctionSelector(
  "bridgeETHTo(address,uint32,bytes)"
);

/** @typedef {import("./withdrawalActivityValues").WithdrawalActivityItem} WithdrawalActivityItem */

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
