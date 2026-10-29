import { observeDepositStatus } from "@dusk/evm-sdk";
import { createPublicClient, http } from "viem";

import { networkStore } from "$lib/stores";
import { duskEvm, duskEvmAdapterUrl } from "$lib/web3/duskEvm";
import {
  depositActivityStore,
  getRememberedDepositActivity,
  getRememberedDepositTransaction,
  hydrateDepositActivity,
  pendingDepositAmountLux,
  rememberDepositTransaction,
  updateDepositTransaction,
} from "$lib/bridge/depositActivityStorage";
import { findDepositArrival } from "$lib/bridge/depositArrival";
import { isDepositTerminal } from "$lib/bridge/depositLifecycle";
import {
  normalizedDuskTxHash,
  normalizedTxHash,
} from "$lib/bridge/withdrawalActivityValues";
import { errorMessage } from "$lib/dusk/error";

const ACTIVE_POLL_INTERVAL_MS = 5_000;
const BACKGROUND_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 300_000;
const activeTrackers = new Map();

let l1Client;

/** DuskEVM's own RPC: a deposit is followed with no EVM wallet connected. */
let l2Client;

class DuskDepositExecutionError extends Error {}

export {
  depositActivityStore,
  getRememberedDepositActivity,
  hydrateDepositActivity,
  pendingDepositAmountLux,
  rememberDepositTransaction,
};

function trackingClients() {
  const adapterUrl = duskEvmAdapterUrl();

  if (!adapterUrl) {
    throw new Error("DuskEVM L1 bridge RPC is not configured.");
  }

  const [l2RpcUrl] = duskEvm.rpcUrls.default.http;

  if (!l2RpcUrl) {
    throw new Error("DuskEVM RPC is not configured.");
  }

  l1Client ??= createPublicClient({ transport: http(adapterUrl) });
  l2Client ??= createPublicClient({
    chain: /** @type {import("viem").Chain} */ (duskEvm),
    transport: http(l2RpcUrl),
  });

  return { l1Client, l2Client };
}

/** @param {string} transactionHash */
async function finalizedDuskTransaction(transactionHash) {
  const network = await networkStore.connect();
  const transactionResult = await network.query(
    `tx(hash: "${transactionHash}") { blockHeight blockTimestamp err }`
  );

  if (!transactionResult?.tx) return null;

  const blockHeight = BigInt(transactionResult.tx.blockHeight);
  const blockResult = await network.query(
    `block(height: ${blockHeight}) { status }`
  );
  const duskBlock = blockResult?.block;

  if (!duskBlock || !Object.hasOwn(duskBlock.status ?? {}, "Final")) {
    return null;
  }

  if (transactionResult.tx.err) {
    throw new DuskDepositExecutionError(
      `The DuskDS deposit failed: ${transactionResult.tx.err}`
    );
  }

  const seconds = Number(transactionResult.tx.blockTimestamp);

  return {
    blockHeight,
    timestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
  };
}

/** @param {any} remembered */
async function resolveL1TransactionHash(remembered) {
  if (remembered.l1TransactionHash) return remembered.l1TransactionHash;

  const finalized = await finalizedDuskTransaction(remembered.transactionHash);

  if (!finalized) return null;

  // What DuskEVM's explorer times its payment against, from Dusk's clock.
  if (finalized.timestamp && !remembered.l1BlockTimestamp) {
    updateDepositTransaction(remembered.transactionHash, {
      l1BlockTimestamp: finalized.timestamp,
    });
  }

  const { l1Client: client } = trackingClients();
  const resolved = await client.request({
    method: "duskevm_getTransactionHashByDuskHash",
    params: [remembered.transactionHash],
  });

  if (resolved === null) return null;

  const hash = normalizedTxHash(resolved);
  if (!hash) {
    throw new Error(
      "The DuskEVM adapter returned no matching transaction for the finalized DuskDS deposit."
    );
  }

  updateDepositTransaction(remembered.transactionHash, {
    l1TransactionHash: hash,
  });
  return hash;
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

/** @param {any} remembered */
function pendingObservationPatch(remembered) {
  const updatedAt = Date.now();
  return updateDepositTransaction(remembered.transactionHash, {
    lastCheckedAt: updatedAt,
    trackingError: null,
    updatedAt,
  });
}

/**
 * @param {any} remembered
 * @param {unknown} error
 */
function failedObservationPatch(remembered, error) {
  const updatedAt = Date.now();
  const failedOnL1 = error instanceof DuskDepositExecutionError;

  return updateDepositTransaction(remembered.transactionHash, {
    ...(failedOnL1
      ? { failureLayer: "l1", stage: "failed", statusMessage: error.message }
      : {}),
    lastCheckedAt: updatedAt,
    trackingError: failedOnL1 ? null : errorMessage(error),
    updatedAt,
  });
}

/**
 * A deposit that DuskEVM's adapter can't follow, found arrived on DuskEVM's
 * explorer: completed, with the DuskEVM transaction that paid it. Null while
 * it isn't there, or the explorer can't be read.
 *
 * @param {any} remembered
 */
async function arrivedOnExplorer(remembered) {
  const arrival = await findDepositArrival(
    remembered,
    hydrateDepositActivity()
  ).catch(() => null);

  if (!arrival) return null;

  const updatedAt = Date.now();

  return updateDepositTransaction(remembered.transactionHash, {
    arrivedAt: arrival.at,
    failureLayer: null,
    l1ConfirmedAt: remembered.l1ConfirmedAt ?? updatedAt,
    l2BlockNumber: arrival.blockNumber,
    l2TransactionHash: arrival.hash,
    lastCheckedAt: updatedAt,
    stage: "completed",
    statusMessage: null,
    trackingError: null,
    updatedAt,
  });
}

/**
 * When a deposit DuskEVM's adapter says arrived did: its DuskEVM block's
 * time, read once; null before it arrived, or when it can't be read.
 *
 * @param {{ l2BlockNumber: string | null, stage: string }} patch
 * @returns {Promise<number | null>}
 */
async function arrivalTime({ l2BlockNumber, stage }) {
  if (stage !== "completed" || !l2BlockNumber) {
    return null;
  }

  try {
    const block = await trackingClients().l2Client.getBlock({
      blockNumber: BigInt(l2BlockNumber),
    });

    return Number(block.timestamp) * 1000 || null;
  } catch {
    return null;
  }
}

/** @param {string} transactionHash */
export async function refreshDepositTransaction(transactionHash) {
  const remembered = getRememberedDepositTransaction(transactionHash);

  if (!remembered || isDepositTerminal(remembered)) return remembered;

  try {
    const l1TransactionHash = await resolveL1TransactionHash(remembered);

    // The adapter doesn't know it (yet): DuskEVM's explorer may.
    if (!l1TransactionHash) {
      return (
        (await arrivedOnExplorer(remembered)) ??
        pendingObservationPatch(remembered)
      );
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

    const patch = observationPatch(remembered, status, metadata);

    return updateDepositTransaction(remembered.transactionHash, {
      ...patch,
      arrivedAt: remembered.arrivedAt ?? (await arrivalTime(patch)),
    });
  } catch (error) {
    // The adapter can't say, as when it doesn't have the method: DuskEVM's
    // explorer can. A deposit that failed on Dusk didn't arrive.
    const arrived =
      error instanceof DuskDepositExecutionError
        ? null
        : await arrivedOnExplorer(remembered);

    return arrived ?? failedObservationPatch(remembered, error);
  }
}

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/**
 * @param {number} unchangedPolls
 * @param {boolean} hidden
 */
export function depositTrackingPollInterval(unchangedPolls, hidden) {
  const base = hidden ? BACKGROUND_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
  const backoff = 2 ** Math.min(6, Math.floor(unchangedPolls / 6));

  return Math.min(MAX_POLL_INTERVAL_MS, base * backoff);
}

/** @param {any} item */
function progressIdentity(item) {
  return [item?.stage, item?.l1TransactionHash, item?.l2TransactionHash].join(
    ":"
  );
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
    let unchangedPolls = 0;
    let previousProgress = progressIdentity(
      getRememberedDepositTransaction(hash)
    );

    while (true) {
      const item = await refreshDepositTransaction(hash);

      if (!item || isDepositTerminal(item)) return item;

      const currentProgress = progressIdentity(item);
      unchangedPolls =
        currentProgress === previousProgress ? unchangedPolls + 1 : 0;
      previousProgress = currentProgress;

      await delay(
        depositTrackingPollInterval(
          unchangedPolls,
          document.visibilityState === "hidden"
        )
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

/**
 * A deposit in the history, as this browser keeps deposits: kept for the
 * DuskEVM address it names, where it wasn't; a final one with its Dusk
 * block's time and height, which its arrival is looked for after; and one
 * that failed on Dusk as never having left.
 *
 * @param {ActivityRow} row A deposit, as the history has it
 * @param {import("./depositActivityStorage").DepositActivityItem | undefined} kept
 */
function keepHistoryDeposit(row, kept) {
  const call = /** @type {{ amount: string, to: string }} */ (row.bridge);
  const hash = /** @type {string} */ (normalizedDuskTxHash(row.hash));
  const isFinal = row.source === "archive" || row.source === "both";
  let item =
    kept ??
    rememberDepositTransaction(hash, {
      account: call.to,
      amountLux: call.amount,
      createdAt: row.timestamp ?? row.submittedAt ?? Date.now(),
    });

  if (item && isFinal && row.timestamp && !item.l1BlockTimestamp) {
    item = updateDepositTransaction(hash, {
      l1BlockHeight:
        row.blockHeight === undefined ? null : String(row.blockHeight),
      l1BlockTimestamp: row.timestamp,
    });
  }

  return item && row.status === "failed" && !isDepositTerminal(item)
    ? updateDepositTransaction(hash, { failureLayer: "l1", stage: "failed" })
    : item;
}

/**
 * The deposits to DuskEVM in the history, followed to DuskEVM as the ones
 * sent from here are, with no EVM wallet needed: the DuskEVM address each
 * pays is the deposit's own. They're followed on a network with DuskEVM
 * only.
 *
 * @param {ActivityRow[]} rows
 * @returns {Set<string>} The deposits' Dusk transactions, as kept
 */
export function followHistoryDeposits(rows) {
  const kept = new Map(
    hydrateDepositActivity().map((item) => [item.transactionHash, item])
  );
  /** @type {Set<string>} */
  const hashes = new Set();

  for (const row of rows) {
    const hash = normalizedDuskTxHash(row.hash);

    if (row.bridge?.kind === "deposit" && hash) {
      const item = keepHistoryDeposit(row, kept.get(hash));

      hashes.add(hash);

      if (item && !isDepositTerminal(item) && duskEvmAdapterUrl()) {
        void trackDepositTransaction(hash);
      }
    }
  }

  return hashes;
}
