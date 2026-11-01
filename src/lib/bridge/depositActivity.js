import { observeDepositStatus } from "@dusk/evm-sdk";
import { get } from "svelte/store";
import { createPublicClient, http } from "viem";

import { activityState, currentActivity } from "$lib/activity";
import { archiveAt } from "$lib/activity/activityHistory";
import { bridgeNetwork } from "$lib/bridge/bridgeCalls";
import { networkStore } from "$lib/stores";
import { nodeBaseUrl } from "$lib/url";
import { duskEvm, duskEvmAdapterUrl } from "$lib/web3/duskEvm";
import {
  depositActivityStore,
  getRememberedDepositActivity,
  getRememberedDepositTransaction,
  hydrateDepositActivity,
  pendingDepositAmountLux,
  rememberDepositTransaction,
  rememberedDeposits,
  updateDepositTransaction,
} from "$lib/bridge/depositActivityStorage";
import { isDepositTerminal } from "$lib/bridge/depositLifecycle";
import {
  normalizedDuskTxHash,
  normalizedTxHash,
} from "$lib/bridge/withdrawalActivityValues";
import { errorMessage } from "$lib/dusk/error";
import { walletDataScope } from "$lib/wallets/dataNames";

/**
 * Each deposit is followed for the wallet that keeps it, open as the
 * following begins (`scope`): what a read finds is kept for that wallet,
 * and the following ends once another wallet opened.
 *
 * @typedef {import("$lib/wallets/dataNames").WalletDataScope} WalletDataScope
 */

const ACTIVE_POLL_INTERVAL_MS = 5_000;
const BACKGROUND_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 300_000;

/** The deposits followed, by wallet and hash. */
const activeTrackers = new Map();

/**
 * @param {WalletDataScope} scope
 * @param {string} hash
 */
const followKey = (scope, hash) => `${scope.id} ${hash}`;

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

/**
 * @param {any} remembered
 * @param {WalletDataScope} scope
 */
async function resolveL1TransactionHash(remembered, scope) {
  if (remembered.l1TransactionHash) return remembered.l1TransactionHash;

  const finalized = await finalizedDuskTransaction(remembered.transactionHash);

  if (!finalized) return null;

  // What its arrival on DuskEVM is timed against, from Dusk's clock.
  if (finalized.timestamp && !remembered.l1BlockTimestamp) {
    updateDepositTransaction(
      remembered.transactionHash,
      { l1BlockTimestamp: finalized.timestamp },
      scope
    );
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

  updateDepositTransaction(
    remembered.transactionHash,
    { l1TransactionHash: hash },
    scope
  );
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

/**
 * @param {any} remembered
 * @param {WalletDataScope} scope
 */
function pendingObservationPatch(remembered, scope) {
  const updatedAt = Date.now();
  return updateDepositTransaction(
    remembered.transactionHash,
    { lastCheckedAt: updatedAt, trackingError: null, updatedAt },
    scope
  );
}

/**
 * @param {any} remembered
 * @param {unknown} error
 * @param {WalletDataScope} scope
 */
function failedObservationPatch(remembered, error, scope) {
  const updatedAt = Date.now();
  const failedOnL1 = error instanceof DuskDepositExecutionError;

  return updateDepositTransaction(
    remembered.transactionHash,
    {
      ...(failedOnL1
        ? { failureLayer: "l1", stage: "failed", statusMessage: error.message }
        : {}),
      lastCheckedAt: updatedAt,
      trackingError: failedOnL1 ? null : errorMessage(error),
      updatedAt,
    },
    scope
  );
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

/**
 * The read of DuskEVM under way, for every deposit on its way, by wallet.
 *
 * @type {Map<number, Promise<void>>}
 */
const duskEvmReads = new Map();

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
 * The node's network as the wallet follows DuskEVM on it: the bridge's
 * contracts on Dusk, and DuskEVM's L2 bridge and RPC, as set for local work
 * or as its file has them. Null where they aren't known.
 *
 * @returns {import("@dusk-network/networks").Network | null}
 */
function followedNetwork() {
  const net = bridgeNetwork();
  const l2StandardBridge = duskEvm.contracts.L2StandardBridge.address;
  const [rpcUrl] = duskEvm.rpcUrls.default.http;

  return net?.duskEvm && l2StandardBridge && rpcUrl
    ? {
        ...net,
        duskEvm: {
          ...net.duskEvm,
          predeploys: {
            ...net.duskEvm.predeploys,
            l2StandardBridge: /** @type {`0x${string}`} */ (l2StandardBridge),
          },
          rpcUrl,
        },
      }
    : null;
}

/**
 * The deposits on their way, as the history of the account shown has them,
 * which says who sent each and from which block; else as this browser keeps
 * them.
 *
 * @param {import("./depositActivityStorage").DepositActivityItem[]} waiting
 * @param {typeof import("@dusk-network/app-core/bridge").depositOf} depositOf
 * @returns {import("@dusk-network/app-core/bridge").Deposit[]}
 */
function depositsOf(waiting, depositOf) {
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
 * (`@dusk-network/app-core/bridge`, loaded then): by the bridge's event
 * from the DuskEVM address of the account that sent each, its equal
 * deposits before it paid first, as its history on Dusk says, however long
 * ago it was sent. Each that arrived is kept completed, with the DuskEVM
 * transaction that paid it and when, for the wallet that keeps them.
 *
 * @param {WalletDataScope} scope
 */
async function readDuskEvm(scope) {
  const net = followedNetwork();
  const kept = scope.isOpen()
    ? hydrateDepositActivity()
    : rememberedDeposits(scope);
  const waiting = kept.filter(isOnItsWay);

  if (!net || !waiting.length) return;

  const bridge = await import("@dusk-network/app-core/bridge");
  const { arrivals } = await bridge.depositArrivals({
    archive: archiveAt(nodeBaseUrl()),
    blockTimes: duskEvmBlockTimes,
    deposits: depositsOf(waiting, bridge.depositOf),
    network: net,
    taken: kept.flatMap(({ l2TransactionHash }) =>
      l2TransactionHash ? [l2TransactionHash] : []
    ),
    via: "rpc",
    // This browser may see a deposit only long after it was sent.
    waitMs: Infinity,
  });
  const updatedAt = Date.now();

  for (const item of waiting) {
    const arrival = arrivals.get(item.transactionHash);

    if (arrival?.state === "arrived") {
      updateDepositTransaction(
        item.transactionHash,
        {
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
        },
        scope
      );
    } else if (arrival?.scan) {
      duskEvmScans.set(item.transactionHash, arrival.scan);
    }
  }
}

/**
 * A deposit that DuskEVM's adapter can't follow, found arrived on DuskEVM:
 * completed, with the DuskEVM transaction that paid it. Null while it isn't
 * there, or DuskEVM can't be read. One read looks for every deposit on its
 * way that its wallet keeps.
 *
 * @param {any} remembered
 * @param {WalletDataScope} scope
 */
async function arrivedOnDuskEvm(remembered, scope) {
  let read = duskEvmReads.get(scope.id);

  if (!read) {
    read = readDuskEvm(scope).finally(() => duskEvmReads.delete(scope.id));
    duskEvmReads.set(scope.id, read);
  }

  await read.catch(() => {});

  const item = getRememberedDepositTransaction(
    remembered.transactionHash,
    scope
  );

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

/** @type {Map<string, Promise<any>>} The arrival times being read, by wallet and deposit. */
const arrivalReads = new Map();

/**
 * Reads when a deposit that arrived did, where it wasn't read before: one
 * read at a time per deposit.
 *
 * @param {any} item
 * @param {WalletDataScope} scope
 */
function readArrivalTime(item, scope) {
  const hash = item.transactionHash;
  const key = followKey(scope, hash);
  let read = arrivalReads.get(key);

  if (!read) {
    read = arrivalTime(item)
      .then((at) =>
        at ? updateDepositTransaction(hash, { arrivedAt: at }, scope) : item
      )
      .finally(() => arrivalReads.delete(key));
    arrivalReads.set(key, read);
  }

  return read;
}

/**
 * A deposit that's done, which is read no more: but for when it arrived,
 * where that wasn't read yet.
 *
 * @param {any} item
 * @param {WalletDataScope} scope
 */
const doneDeposit = (item, scope) =>
  lacksArrivalTime(item) ? readArrivalTime(item, scope) : item;

/**
 * Reads where a deposit is, for the wallet that keeps it: the one open as
 * it's asked for by default.
 *
 * @param {string} transactionHash
 * @param {WalletDataScope} [scope]
 */
export async function refreshDepositTransaction(
  transactionHash,
  scope = walletDataScope()
) {
  const remembered = getRememberedDepositTransaction(transactionHash, scope);

  if (!remembered || isDepositTerminal(remembered))
    return doneDeposit(remembered, scope);

  try {
    const l1TransactionHash = await resolveL1TransactionHash(remembered, scope);

    // The adapter doesn't know it (yet): DuskEVM itself may.
    if (!l1TransactionHash) {
      return (
        (await arrivedOnDuskEvm(remembered, scope)) ??
        pendingObservationPatch(remembered, scope)
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

    return updateDepositTransaction(
      remembered.transactionHash,
      {
        ...patch,
        arrivedAt: remembered.arrivedAt ?? (await arrivalTime(patch)),
      },
      scope
    );
  } catch (error) {
    // The adapter can't say, as when it doesn't have the method: DuskEVM
    // itself can. A deposit that failed on Dusk didn't arrive.
    const arrived =
      error instanceof DuskDepositExecutionError
        ? null
        : await arrivedOnDuskEvm(remembered, scope);

    return arrived ?? failedObservationPatch(remembered, error, scope);
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
 * does not discard the in-flight bridge operation: for the wallet that
 * keeps it (`scope`, the one open by default), until another wallet opens.
 *
 * @param {string} transactionHash
 * @param {WalletDataScope} [scope]
 */
export function trackDepositTransaction(
  transactionHash,
  scope = walletDataScope()
) {
  const hash = transactionHash.toLowerCase();
  const key = followKey(scope, hash);
  const active = activeTrackers.get(key);

  if (active) return active;

  if (!scope.isOpen()) {
    return Promise.resolve(getRememberedDepositTransaction(hash, scope));
  }

  const tracker = (async () => {
    let unchangedPolls = 0;
    let previousProgress = progressIdentity(
      getRememberedDepositTransaction(hash, scope)
    );

    while (true) {
      const item = await refreshDepositTransaction(hash, scope);

      if (!item || isDepositTerminal(item) || !scope.isOpen()) return item;

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

      if (!scope.isOpen()) return item;
    }
  })().finally(() => activeTrackers.delete(key));

  activeTrackers.set(key, tracker);
  return tracker;
}

/**
 * Follows a kept deposit to DuskEVM: one under way until it's done, and one
 * that arrived without the time it did, until that's read.
 *
 * @param {any} item
 * @param {WalletDataScope} scope
 */
function followDeposit(item, scope) {
  if (!isDepositTerminal(item)) {
    void trackDepositTransaction(item.transactionHash, scope);
  } else if (lacksArrivalTime(item)) {
    void readArrivalTime(item, scope);
  }
}

/**
 * @param {string | null | undefined} account
 * @returns {any[]} The deposits under way, followed again
 */
export function resumeDepositTracking(account) {
  const scope = walletDataScope();
  const kept = hydrateDepositActivity().filter(
    (item) => item.account === null || item.account === account?.toLowerCase()
  );

  for (const deposit of kept) {
    followDeposit(deposit, scope);
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
  const scope = walletDataScope();
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
        followDeposit(item, scope);
      }
    }
  }

  return hashes;
}
