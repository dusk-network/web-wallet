import { observeDepositStatus } from "@dusk/evm-sdk";
import { getPublicClient } from "@wagmi/core";
import { createPublicClient, http } from "viem";

import { duskEvm, wagmiConfig } from "$lib/web3/walletConnection";
import {
  depositActivityStore,
  getRememberedDepositActivity,
  getRememberedDepositTransaction,
  hydrateDepositActivity,
  pendingDepositAmountLux,
  rememberDepositTransaction,
  updateDepositTransaction,
} from "$lib/bridge/depositActivityStorage";
import { isDepositTerminal } from "$lib/bridge/depositLifecycle";
import { normalizedTxHash } from "$lib/bridge/withdrawalActivityValues";

const L1_RPC_URL = import.meta.env.VITE_EVM_L1_BRIDGE_RPC_URL;
const ACTIVE_POLL_INTERVAL_MS = 5_000;
const BACKGROUND_POLL_INTERVAL_MS = 30_000;
const activeTrackers = new Map();

let l1Client;

export {
  depositActivityStore,
  getRememberedDepositActivity,
  hydrateDepositActivity,
  pendingDepositAmountLux,
  rememberDepositTransaction,
};

function trackingClients() {
  if (!L1_RPC_URL) {
    throw new Error("DuskEVM L1 bridge RPC is not configured.");
  }

  l1Client ??= createPublicClient({ transport: http(L1_RPC_URL) });
  const l2Client = getPublicClient(wagmiConfig, { chainId: duskEvm.id });

  if (!l2Client) {
    throw new Error("DuskEVM RPC is not configured.");
  }

  return { l1Client, l2Client };
}

/** @param {any} remembered */
async function resolveL1TransactionHash(remembered) {
  if (remembered.l1TransactionHash) return remembered.l1TransactionHash;

  const { l1Client: client } = trackingClients();
  const resolved = await client.request({
    method: "duskevm_getTransactionHashByDuskHash",
    params: [remembered.transactionHash],
  });

  if (resolved === null) return null;

  const hash = normalizedTxHash(resolved);
  if (!hash) {
    throw new Error(
      "The DuskEVM adapter returned an invalid transaction hash."
    );
  }

  updateDepositTransaction(remembered.transactionHash, {
    l1TransactionHash: hash,
  });
  return hash;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {any} metadata */
function finalizedOnL1(metadata) {
  return (
    metadata.stage === "l2_pending" ||
    metadata.stage === "completed" ||
    (metadata.stage === "failed" && metadata.failureLayer === "l2")
  );
}

/**
 * @param {any} remembered
 * @param {any} metadata
 */
function assertStatusProgression(remembered, metadata) {
  if (remembered.stage === "l2_pending" && metadata.stage === "l1_pending") {
    throw new Error(
      "The deposit RPC returned an older state than the last confirmed state."
    );
  }
}

/**
 * @param {any} remembered
 * @param {any} status
 * @param {any} metadata
 */
function observationPatch(remembered, status, metadata) {
  return {
    failureLayer: metadata.failureLayer ?? null,
    l1BlockHeight: metadata.l1BlockHeight ?? null,
    l1ConfirmedAt: finalizedOnL1(metadata)
      ? (remembered.l1ConfirmedAt ?? status.updatedAt)
      : remembered.l1ConfirmedAt,
    l2BlockNumber: metadata.l2BlockNumber ?? null,
    l2TransactionHash: metadata.l2TransactionHash ?? null,
    lastCheckedAt: status.updatedAt,
    stage: metadata.stage,
    statusMessage: status.message ?? null,
    trackingError: null,
    updatedAt: status.updatedAt,
  };
}

/** @param {string} transactionHash */
export async function refreshDepositTransaction(transactionHash) {
  const remembered = getRememberedDepositTransaction(transactionHash);

  if (!remembered || isDepositTerminal(remembered)) return remembered;

  try {
    const l1TransactionHash = await resolveL1TransactionHash(remembered);

    if (!l1TransactionHash) {
      const updatedAt = Date.now();
      return updateDepositTransaction(remembered.transactionHash, {
        lastCheckedAt: updatedAt,
        trackingError: null,
        updatedAt,
      });
    }

    const status = await observeDepositStatus({
      ...trackingClients(),
      l1TransactionHash,
    });
    const metadata = status.metadata;

    if (!metadata) {
      throw new Error("The deposit observer returned no tracking metadata.");
    }

    assertStatusProgression(remembered, metadata);

    return updateDepositTransaction(
      remembered.transactionHash,
      observationPatch(remembered, status, metadata)
    );
  } catch (error) {
    return updateDepositTransaction(remembered.transactionHash, {
      lastCheckedAt: Date.now(),
      trackingError: errorMessage(error),
      updatedAt: Date.now(),
    });
  }
}

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/**
 * Continue tracking independently of the initiating component so navigation
 * does not discard the in-flight bridge operation.
 *
 * @param {string} transactionHash
 */
export function trackDepositTransaction(transactionHash) {
  const hash = transactionHash.toLowerCase();
  const active = activeTrackers.get(hash);

  if (active) return active;

  const tracker = (async () => {
    while (true) {
      const item = await refreshDepositTransaction(hash);

      if (!item || isDepositTerminal(item)) return item;

      await delay(
        document.visibilityState === "hidden"
          ? BACKGROUND_POLL_INTERVAL_MS
          : ACTIVE_POLL_INTERVAL_MS
      );
    }
  })().finally(() => activeTrackers.delete(hash));

  activeTrackers.set(hash, tracker);
  return tracker;
}

/** @param {string | null | undefined} account */
export function resumeDepositTracking(account) {
  const deposits = hydrateDepositActivity().filter(
    (item) =>
      !isDepositTerminal(item) &&
      (item.account === null || item.account === account?.toLowerCase())
  );

  for (const deposit of deposits) {
    void trackDepositTransaction(deposit.transactionHash);
  }

  return deposits;
}
