/**
 * A DuskEVM account's withdrawals as DuskEVM's explorer lists them, read by
 * `@dusk-network/app-core/duskevm-withdrawals`, as the wallet keeps them.
 */

import {
  explorerStage,
  explorerWithdrawals,
  withdrawalsByNonce,
} from "@dusk-network/app-core/duskevm-withdrawals";

import { duskEvm } from "$lib/web3/walletConnection";
import { withdrawalNetwork } from "$lib/bridge/withdrawals";

import {
  MAX_ACTIVITY_ITEMS,
  normalizedAddress,
  normalizedTxHash,
} from "$lib/bridge/withdrawalActivityValues";

/** @typedef {import("./withdrawalActivityValues").WithdrawalActivityItem} WithdrawalActivityItem */

/**
 * @param {string | null | undefined} status
 */
export const explorerStatusToStage = (status) =>
  explorerStage(status) ?? "submitted";

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

/** The explorer's API, as set for local work or from the network's file. */
function explorerApi() {
  const baseUrl = explorerBaseUrl();

  if (!baseUrl) {
    throw new Error("The DuskEVM block explorer is not configured.");
  }

  return `${baseUrl}/api/v2`;
}

/**
 * The explorer's answers, refused in the wallet's words.
 *
 * @param {Parameters<typeof fetch>[0]} input
 * @param {Parameters<typeof fetch>[1]} [init]
 */
async function explorerFetch(input, init) {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`Blockscout request failed with HTTP ${response.status}.`);
  }

  return response;
}

/**
 * @param {import("@dusk-network/app-core/duskevm-withdrawals").ExplorerWithdrawal} item
 * @returns {WithdrawalActivityItem}
 */
const itemOf = (item) =>
  /** @type {WithdrawalActivityItem} */ ({
    account: item.from,
    amountWei: item.amountWei,
    blockNumber: item.blockNumber,
    chainId: duskEvm.id,
    createdAt: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
    explorerStatus: item.explorerStatus,
    l1TransactionHash: item.l1TransactionHash,
    // Whom it pays on Dusk, as the call says.
    recipient: item.destination,
    source: "explorer",
    stage: explorerStatusToStage(item.explorerStatus),
    timestamp: item.timestamp,
    transactionHash: item.hash,
  });

const network = () =>
  /** @type {import("@dusk-network/networks").Network} */ (withdrawalNetwork());

/**
 * The DuskEVM transactions of withdrawals known by their nonces, as their
 * proofs on Dusk carry them, from the explorer's list of all withdrawals.
 * However a withdrawal was sent, the list has it.
 *
 * @param {bigint[]} nonces
 * @returns {Promise<Map<string, WithdrawalActivityItem>>} By nonce, as text
 */
export async function findWithdrawalsByNonce(nonces) {
  const found = await withdrawalsByNonce({
    fetch: explorerFetch,
    network: network(),
    nonces,
    url: explorerApi(),
  });

  return new Map([...found].map(([nonce, item]) => [nonce, itemOf(item)]));
}

/**
 * The account's own withdrawals on DuskEVM, newest first, each with what
 * the explorer says of it.
 *
 * @param {string} account
 */
export async function fetchWithdrawalActivity(account) {
  const address = normalizedAddress(account);

  if (!address) {
    throw new Error("Connect a valid DuskEVM account to load activity.");
  }

  if (!normalizedAddress(duskEvm.contracts?.L2StandardBridge?.address)) {
    throw new Error("The DuskEVM bridge contract is not configured.");
  }

  const listed = await explorerWithdrawals({
    address,
    fetch: explorerFetch,
    maxItems: MAX_ACTIVITY_ITEMS,
    network: network(),
    url: explorerApi(),
  });

  return listed.map(itemOf);
}
