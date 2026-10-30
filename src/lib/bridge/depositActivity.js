import { observeDepositStatus } from "@dusk/evm-sdk";
import { depositArrivals, depositOf } from "@dusk-network/app-core/bridge";
import { get } from "svelte/store";
import { createPublicClient, http } from "viem";

import { activityState, currentActivity } from "$lib/activity";
import { archiveAt } from "$lib/activity/activityHistory";
import { networkStore } from "$lib/stores";
import nodeNetwork from "$lib/stores/nodeNetwork";
import { nodeBaseUrl } from "$lib/url";
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

  // What its arrival on DuskEVM is timed against, from Dusk's clock.
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

/** DuskEVM's block times, as its reads find them. */
const duskEvmBlockTimes = new Map();

/**
 * Where the last search on DuskEVM for each deposit stopped, by its Dusk
 * transaction: the next one carries on from there.
 *
 * @type {Map<string, import("@dusk-network/app-core/bridge").Scan>}
 */
const duskEvmScans = new Map();

/** The read of DuskEVM under way, for every deposit on its way. */
/** @type {Promise<void> | null} */
let duskEvmRead = null;

/**
 * A deposit on its way to a DuskEVM address, as this browser keeps it.
 *
 * @param {import("./depositActivityStorage").DepositActivityItem} item
 */
const isOnItsWay = (item) =>
  Boolean(item.account && Number(item.amountLux) > 0) &&
  !item.l2TransactionHash &&
  !isDepositTerminal(item);

/**
 * The deposits on their way, as the history of the account shown has them,
 * which says who sent each and from which block; else as this browser keeps
 * them.
 *
 * @param {import("./depositActivityStorage").DepositActivityItem[]} waiting
 * @returns {import("@dusk-network/app-core/bridge").Deposit[]}
 */
function depositsOf(waiting) {
  const account = currentActivity()?.options.account;
  const history = new Map(
    get(activityState).rows.flatMap((row) => {
      const deposit = row.entry && depositOf(row.entry, account);

      return deposit ? [[deposit.hash, deposit]] : [];
    })
  );

  return waiting.map((item) => ({
    ...(history.get(item.transactionHash) ?? {
      amount: /** @type {string} */ (item.amountLux),
      at: item.l1BlockTimestamp,
      hash: item.transactionHash,
      to: /** @type {string} */ (item.account),
    }),
    scan: duskEvmScans.get(item.transactionHash),
  }));
}

/**
 * Looks for the deposits on their way on DuskEVM's RPC
 * (`@dusk-network/app-core/bridge`): by the bridge's event from the DuskEVM
 * address of the account that sent each, its equal deposits before it paid
 * first, as its history on Dusk says. Each that arrived is kept completed,
 * with the DuskEVM transaction that paid it and when.
 */
async function readDuskEvm() {
  const net = get(nodeNetwork);
  const kept = hydrateDepositActivity();
  const waiting = kept.filter(isOnItsWay);

  if (!net?.duskEvm || !waiting.length) return;

  const { arrivals } = await depositArrivals({
    archive: archiveAt(nodeBaseUrl()),
    blockTimes: duskEvmBlockTimes,
    deposits: depositsOf(waiting),
    network: net,
    rpcUrl: duskEvm.rpcUrls.default.http[0],
    taken: kept.flatMap(({ l2TransactionHash }) =>
      l2TransactionHash ? [l2TransactionHash] : []
    ),
    via: "rpc",
  });
  const updatedAt = Date.now();

  for (const item of waiting) {
    const arrival = arrivals.get(item.transactionHash);

    if (arrival?.state === "arrived") {
      updateDepositTransaction(item.transactionHash, {
        arrivedAt: arrival.at,
        failureLayer: null,
        l1ConfirmedAt: item.l1ConfirmedAt ?? updatedAt,
        l2BlockNumber: arrival.block === null ? null : String(arrival.block),
        l2TransactionHash: /** @type {`0x${string}`} */ (arrival.hash),
        lastCheckedAt: updatedAt,
        stage: "completed",
        statusMessage: null,
        trackingError: null,
        updatedAt,
      });
    } else if (arrival?.scan) {
      duskEvmScans.set(item.transactionHash, arrival.scan);
    }
  }
}

/**
 * A deposit that DuskEVM's adapter can't follow, found arrived on DuskEVM:
 * completed, with the DuskEVM transaction that paid it. Null while it isn't
 * there, or DuskEVM can't be read. One read looks for every deposit on its
 * way.
 *
 * @param {any} remembered
 */
async function arrivedOnDuskEvm(remembered) {
  duskEvmRead ??= readDuskEvm().finally(() => {
    duskEvmRead = null;
  });
  await duskEvmRead.catch(() => {});

  const item = getRememberedDepositTransaction(remembered.transactionHash);

  return item?.stage === "completed" ? item : null;
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

/**
 * Whether a deposit that arrived is without the time it did: its DuskEVM
 * block's read failed, and is tried again.
 *
 * @param {any} item
 */
const lacksArrivalTime = (item) =>
  item?.stage === "completed" && !item.arrivedAt && Boolean(item.l2BlockNumber);

/** @type {Map<string, Promise<any>>} The arrival times being read, by deposit. */
const arrivalReads = new Map();

/**
 * Reads when a deposit that arrived did, where it wasn't read before: one
 * read at a time per deposit.
 *
 * @param {any} item
 */
function readArrivalTime(item) {
  const hash = item.transactionHash;
  let read = arrivalReads.get(hash);

  if (!read) {
    read = arrivalTime(item)
      .then((at) =>
        at ? updateDepositTransaction(hash, { arrivedAt: at }) : item
      )
      .finally(() => arrivalReads.delete(hash));
    arrivalReads.set(hash, read);
  }

  return read;
}

/**
 * A deposit that's done, which is read no more: but for when it arrived,
 * where that wasn't read yet.
 *
 * @param {any} item
 */
const doneDeposit = (item) =>
  lacksArrivalTime(item) ? readArrivalTime(item) : item;

/** @param {string} transactionHash */
export async function refreshDepositTransaction(transactionHash) {
  const remembered = getRememberedDepositTransaction(transactionHash);

  if (!remembered || isDepositTerminal(remembered))
    return doneDeposit(remembered);

  try {
    const l1TransactionHash = await resolveL1TransactionHash(remembered);

    // The adapter doesn't know it (yet): DuskEVM itself may.
    if (!l1TransactionHash) {
      return (
        (await arrivedOnDuskEvm(remembered)) ??
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
    // The adapter can't say, as when it doesn't have the method: DuskEVM
    // itself can. A deposit that failed on Dusk didn't arrive.
    const arrived =
      error instanceof DuskDepositExecutionError
        ? null
        : await arrivedOnDuskEvm(remembered);

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

/**
 * Follows a kept deposit to DuskEVM: one under way until it's done, and one
 * that arrived without the time it did, until that's read.
 *
 * @param {any} item
 */
function followDeposit(item) {
  if (!isDepositTerminal(item)) {
    void trackDepositTransaction(item.transactionHash);
  } else if (lacksArrivalTime(item)) {
    void readArrivalTime(item);
  }
}

/**
 * @param {string | null | undefined} account
 * @returns {any[]} The deposits under way, followed again
 */
export function resumeDepositTracking(account) {
  const kept = hydrateDepositActivity().filter(
    (item) => item.account === null || item.account === account?.toLowerCase()
  );

  for (const deposit of kept) {
    followDeposit(deposit);
  }

  return kept.filter((item) => !isDepositTerminal(item));
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
  const call = /** @type {NonNullable<ActivityRow["bridge"]>} */ (row.bridge);
  const hash = /** @type {string} */ (normalizedDuskTxHash(row.hash));
  // Its block's time, once the chain's history has it.
  const at = row.entry?.timestamp;
  let item =
    kept ??
    rememberDepositTransaction(hash, {
      account: call.to,
      amountLux: call.amount ?? row.value,
      createdAt: row.time ?? Date.now(),
    });

  if (item && at && !item.l1BlockTimestamp) {
    item = updateDepositTransaction(hash, {
      l1BlockHeight: String(row.blockHeight),
      l1BlockTimestamp: at,
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

    if (row.bridge?.to && hash) {
      const item = keepHistoryDeposit(row, kept.get(hash));

      hashes.add(hash);

      if (item && duskEvmAdapterUrl()) {
        followDeposit(item);
      }
    }
  }

  return hashes;
}
