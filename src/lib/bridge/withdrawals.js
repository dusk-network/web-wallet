/**
 * DuskEVM withdrawals on Dusk, for the wallet's account: where each one is,
 * when it can be claimed, and its proof and its claim, which the wallet
 * signs. `@dusk-network/app-core/duskevm-withdrawals` reads the chains and
 * builds each call, read back before it's handed over; the wallet keeps its
 * settings, its words, the proof whose claim date it showed, the gas price
 * and the signing.
 */

import { Gas } from "@dusk/w3sper";
import {
  WithdrawalError,
  createWithdrawals,
  withdrawalCall,
} from "@dusk-network/app-core/duskevm-withdrawals";
import { MAX_BATCH } from "@hdauven/dusk-multicall";
import { get } from "svelte/store";
import { toHex } from "viem";

import { bridgeNetwork } from "$lib/bridge/bridgeCalls";
import {
  batchedFetch,
  bridgeFacts,
  loadBridgeDriver,
} from "$lib/bridge/bridgeReads";
import { normalizedTxHash } from "$lib/bridge/withdrawalActivityValues";
import { WITHDRAWAL_GAS_REFUSAL } from "$lib/bridge/withdrawalLifecycle";
import { errorMessage } from "$lib/dusk/error";
import {
  gasPriceStore,
  gasStore,
  networkStore,
  settingsStore,
  walletStore,
} from "$lib/stores";
import { nodeBaseUrl } from "$lib/url";
import { duskEvm } from "$lib/web3/walletConnection";
import { duskEvmContractId, duskEvmDriverUrl } from "$lib/web3/duskEvm";

/**
 * @typedef {import("@dusk-network/app-core/duskevm-withdrawals").PortalCall} PortalCall
 * @typedef {import("@dusk-network/app-core/duskevm-withdrawals").PreparedProof} PreparedProof
 * @typedef {import("@dusk-network/app-core/duskevm-withdrawals").WithdrawalClaim} WithdrawalClaim
 * @typedef {import("@dusk-network/app-core/duskevm-withdrawals").WithdrawalStatus} PackageStatus
 * @typedef {Omit<PackageStatus, "proofRejected" | "proofSubmitter"> & {
 *   proofRejected?: boolean,
 *   proofSubmitter?: `0x${string}` | null,
 *   statusMessage?: string,
 * }} WithdrawalStatus
 *   A withdrawal's status as the wallet keeps it: the package's, with why
 *   it waits in words, the proof submitter once someone proved it and
 *   until it's claimed, and whether its proof was rejected only once this
 *   account proved it.
 */

/**
 * DuskEVM's contracts and drivers on Dusk come from the network's file
 * (`$lib/web3/duskEvm`); these set them instead, for local work. The
 * anchor state registry is the one the Portal asks whether a dispute game is
 * proper and respected: with it, a proof goes against a game that has
 * already resolved, so its claim date is exact. `none` leaves it out.
 */
const env = import.meta.env;

/** How long a proof whose claim date was shown is the one sent. */
export const PREPARED_PROOF_MS = 120_000;

/**
 * @param {string | undefined} value
 * @returns {value is `0x${string}`}
 */
const isContractId = (value) => /^(0x)?[0-9a-fA-F]{64}$/.test(value ?? "");

/** @param {string | undefined} value */
function isConfiguredDataDriverUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  const scheme = /^[a-z][a-z0-9+.-]*:/iu.exec(value.trim())?.[0];

  return scheme === undefined || /^https?:$/iu.test(scheme);
}

/** @param {string} value */
const normalizeContractId = (value) => value.replace(/^0x/, "").toLowerCase();

/**
 * @param {unknown} value
 * @returns {value is `0x${string}`}
 */
export const isWithdrawalTxHash = (value) => normalizedTxHash(value) !== null;

/**
 * The anchor state registry's contract ID: the one set, else the network's,
 * or "" with `none`, or where it isn't known.
 */
function anchorStateRegistryContractId() {
  const set = String(env.VITE_EVM_ANCHOR_STATE_REGISTRY_CONTRACT_ID ?? "");

  return set.trim().toLowerCase() === "none"
    ? ""
    : duskEvmContractId(
        "anchor_state_registry",
        isContractId(set.trim()) ? set : undefined
      );
}

/**
 * What proving and claiming a withdrawal on Dusk needs: the Portal and the
 * dispute game factory, with their data drivers, from the network's file
 * or as set; `missing` names what's neither.
 */
export function getWithdrawalFinalizationConfig() {
  const missing = [];
  const optimismPortalContractId = duskEvmContractId(
    "optimism_portal",
    env.VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID
  );
  const disputeGameFactoryContractId = duskEvmContractId(
    "dispute_game_factory",
    env.VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID
  );
  const optimismPortalDataDriverUrl = duskEvmDriverUrl(
    "optimismPortal",
    env.VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL
  );
  const disputeGameFactoryDataDriverUrl = duskEvmDriverUrl(
    "disputeGameFactory",
    env.VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL
  );

  if (!isContractId(optimismPortalContractId)) {
    missing.push("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID");
  }

  if (!isConfiguredDataDriverUrl(optimismPortalDataDriverUrl)) {
    missing.push("VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL");
  }

  if (!isContractId(disputeGameFactoryContractId)) {
    missing.push("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID");
  }

  if (!isConfiguredDataDriverUrl(disputeGameFactoryDataDriverUrl)) {
    missing.push("VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL");
  }

  return Object.freeze({
    anchorStateRegistryContractId: anchorStateRegistryContractId(),
    configured: missing.length === 0,
    disputeGameFactoryContractId: normalizeContractId(
      disputeGameFactoryContractId
    ),
    disputeGameFactoryDataDriverUrl,
    l2RpcUrl: duskEvm.rpcUrls.default.http[0],
    missing,
    optimismPortalContractId: normalizeContractId(optimismPortalContractId),
    optimismPortalDataDriverUrl,
  });
}

function requireWithdrawalFinalizationConfig() {
  const config = getWithdrawalFinalizationConfig();

  if (!config.configured) {
    throw new Error(
      `DuskEVM withdrawal finalization is not configured: ${config.missing.join(
        ", "
      )}`
    );
  }

  return config;
}

/**
 * @typedef {import("@dusk-network/networks").Network} Network
 * @typedef {NonNullable<Network["duskEvm"]>} DuskEvmFile
 */

/**
 * What's set for local work in place of DuskEVM's own: the dispute game
 * factory, the anchor state registry ("" for none) and DuskEVM's bridge;
 * null when it's all as the network's file has it.
 *
 * @param {DuskEvmFile} evm
 */
function setForLocalWork(evm) {
  const factory = normalizeContractId(
    duskEvmContractId(
      "dispute_game_factory",
      env.VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID
    )
  );
  const registry = anchorStateRegistryContractId();
  const l2Bridge = String(
    duskEvm.contracts?.L2StandardBridge?.address ?? ""
  ).toLowerCase();
  /** @param {string} name */
  const idOf = (name) =>
    normalizeContractId(evm.contracts[name]?.contractId ?? "");
  const own =
    idOf("dispute_game_factory") === factory &&
    idOf("anchor_state_registry") === registry &&
    (!l2Bridge || l2Bridge === evm.predeploys.l2StandardBridge?.toLowerCase());

  return own ? null : { factory, l2Bridge, registry };
}

/**
 * @param {Network} net
 * @param {DuskEvmFile} evm
 * @param {NonNullable<ReturnType<typeof setForLocalWork>>} set
 * @returns {Network}
 */
function withSet(net, evm, { factory, l2Bridge, registry }) {
  const { ["anchor_state_registry"]: anchor, ...contracts } = evm.contracts;
  const factoryFile = contracts.dispute_game_factory;

  return /** @type {Network} */ ({
    ...net,
    duskEvm: {
      ...evm,
      contracts: {
        ...contracts,
        ...(registry
          ? { ["anchor_state_registry"]: { ...anchor, contractId: registry } }
          : {}),
        ["dispute_game_factory"]: { ...factoryFile, contractId: factory },
      },
      predeploys: {
        ...evm.predeploys,
        ...(l2Bridge ? { l2StandardBridge: l2Bridge } : {}),
      },
    },
  });
}

/** @type {WeakMap<Network, { key: string, net: Network }>} */
const withSetContracts = new WeakMap();

/**
 * The node's network with DuskEVM's contracts on Dusk (`bridgeNetwork`)
 * and its bridge on DuskEVM as set for local work in place of its file's,
 * the dispute game factory and the anchor state registry too: what
 * withdrawals are read and checked against. Kept per network, as the
 * settings don't change while the wallet runs.
 */
export function withdrawalNetwork() {
  const net = bridgeNetwork();
  const set = net?.duskEvm ? setForLocalWork(net.duskEvm) : null;

  if (!net?.duskEvm || !set) {
    return net;
  }

  const key = `${set.factory} ${set.registry} ${set.l2Bridge}`;

  if (withSetContracts.get(net)?.key !== key) {
    withSetContracts.set(net, { key, net: withSet(net, net.duskEvm, set) });
  }

  return /** @type {{ net: Network }} */ (withSetContracts.get(net)).net;
}

/** @type {{ key: string, net: unknown, withdrawals: ReturnType<typeof createWithdrawals> } | null} */
let current = null;

/**
 * The latest block of the checks under way together (`withOneLatestBlock`):
 * read once, when the first of them asks for it.
 *
 * @type {{ read: ReturnType<typeof networkStore.getLatestBlock> | null } | null}
 */
let sharedLatestBlock = null;

/** Dusk's latest block: the one shared by the checks under way, else read now. */
function latestBlock() {
  if (!sharedLatestBlock) {
    return networkStore.getLatestBlock();
  }

  sharedLatestBlock.read ??= networkStore.getLatestBlock();

  return sharedLatestBlock.read;
}

/** The longest a round's read of Dusk's latest block is shared. */
const SHARED_LATEST_BLOCK_MS = 10_000;

/**
 * Runs `checks` with one read of Dusk's latest block for all of them, as a
 * round of withdrawal checks needs it: made when the first one asks, and
 * shared for 10 seconds at most.
 *
 * @template T
 * @param {() => Promise<T>} checks
 * @returns {Promise<T>}
 */
export async function withOneLatestBlock(checks) {
  const shared = { read: null };
  const end = () => {
    if (sharedLatestBlock === shared) {
      sharedLatestBlock = null;
    }
  };
  const timer = setTimeout(end, SHARED_LATEST_BLOCK_MS);

  sharedLatestBlock = shared;

  try {
    return await checks();
  } finally {
    clearTimeout(timer);
    end();
  }
}

/**
 * The network's withdrawals, read on the node through its Multicall for
 * Dusk batcher with the bundled data drivers, and on DuskEVM's RPC; one
 * for as long as the network and the settings stay.
 */
function withdrawals() {
  const config = requireWithdrawalFinalizationConfig();
  const net = withdrawalNetwork();
  const nodeUrl = nodeBaseUrl();
  const key = [
    nodeUrl,
    config.l2RpcUrl,
    config.optimismPortalDataDriverUrl,
    config.disputeGameFactoryDataDriverUrl,
  ].join("\n");

  if (current?.net !== net || current.key !== key) {
    current = {
      key,
      net,
      withdrawals: createWithdrawals({
        cache: bridgeFacts,
        drivers: {
          disputeGameFactory: () =>
            loadBridgeDriver(config.disputeGameFactoryDataDriverUrl),
          optimismPortal: () =>
            loadBridgeDriver(config.optimismPortalDataDriverUrl),
        },
        duskEvm: { url: config.l2RpcUrl },
        fetch: batchedFetch(nodeUrl),
        gameSearchDepth: Number(env.VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH ?? 64),
        latestBlock,
        maxBatch: MAX_BATCH,
        network: /** @type {Network} */ (net),
        nodeUrl,
      }),
    };
  }

  return current.withdrawals;
}

/** Why a withdrawal waits, in the wallet's words, by the package's reason. */
const WAITS = Object.freeze({
  "game-in-progress":
    "The proof is accepted. Its dispute game is still in progress.",
  "game-not-final":
    "The proof is accepted. Wait for its dispute game to become final.",
  "game-unreadable":
    "The proof is accepted, but its dispute game can't be read right now.",
  "no-games": "No dispute games have been proposed yet.",
  "no-output":
    "No finalized output proposal covering this withdrawal is ready yet.",
  "portal-refuses": "The Portal doesn't take the claim yet.",
  "proof-rejected":
    "The existing proof was rejected, but no replacement output proposal is available yet.",
});

const PROVE_AGAIN =
  "The existing proof is not accepted by the portal, and a newer output proposal is available. Prove the withdrawal again.";

/**
 * @param {PackageStatus} status
 * @returns {string | undefined}
 */
function statusMessage({ error, reason, stage }) {
  switch (stage) {
    case "ready_to_finalize":
      return "";
    case "ready_to_prove":
      return reason === "proof-rejected" ? PROVE_AGAIN : undefined;
    case "waiting_for_output":
      return error ? errorMessage(error) : reason ? WAITS[reason] : undefined;
    case "proven_waiting":
      return reason ? WAITS[reason] : undefined;
    default:
      return undefined;
  }
}

/**
 * @param {PackageStatus} status
 * @returns {WithdrawalStatus}
 */
const asStatus = (status) => ({
  ...status,
  proofRejected: status.disputeGameProxy ? status.proofRejected : undefined,
  // Named once someone proved it, until it's claimed: a claim's status says
  // no more of it.
  proofSubmitter:
    status.stage !== "finalized" && status.proofSubmitterCount > 0n
      ? status.proofSubmitter
      : undefined,
  statusMessage: statusMessage(status),
});

/**
 * Why a withdrawal can't be claimed yet, in the wallet's words.
 *
 * @param {WithdrawalStatus} status
 */
function notReadyMessage(status) {
  if (status.statusMessage) {
    return status.statusMessage;
  }

  switch (status.stage) {
    case "waiting_for_output":
      return "The withdrawal is waiting for an output proposal.";
    case "ready_to_prove":
      return "The withdrawal must be proven before it can be finalized.";
    case "proven_waiting":
      return "The withdrawal is proven but not ready to finalize yet.";
    case "finalized":
      return "The withdrawal is already finalized.";
    default:
      return "The withdrawal is not ready to finalize yet.";
  }
}

/**
 * A refusal of the package's in the wallet's words, where it has them.
 *
 * @param {WithdrawalError} error
 * @returns {string | null}
 */
function refusalWords({ cause, code, reason, status }) {
  switch (code) {
    case "bad-hash":
      return "Enter a valid DuskEVM withdrawal transaction hash.";
    case "not-found":
      return "Withdrawal transaction was not found.";
    case "failed":
      return "Withdrawal transaction failed on DuskEVM.";
    case "gas":
      return WITHDRAWAL_GAS_REFUSAL;
    case "claimed":
      return "The withdrawal is already finalized.";
    case "no-proof":
      return reason === "no-output" && cause
        ? errorMessage(cause)
        : WAITS[reason ?? "no-output"];
    case "not-ready":
    case "proven":
      return status ? notReadyMessage(asStatus(status)) : null;
    default:
      return null;
  }
}

/**
 * @param {unknown} error
 * @returns {never}
 */
function inWords(error) {
  const words = error instanceof WithdrawalError ? refusalWords(error) : null;

  throw words ? new Error(words, { cause: error }) : error;
}

/**
 * Where a withdrawal is, by its DuskEVM transaction, for the wallet's
 * account. `proofGame`, the game its last check found it proved against,
 * puts the game's reads in the same query as the Portal's.
 *
 * @param {`0x${string}`} txHash
 * @param {{ proofGame?: `0x${string}` | null }} [options]
 * @returns {Promise<WithdrawalStatus>}
 */
export async function loadWithdrawalStatus(txHash, { proofGame = null } = {}) {
  if (!isWithdrawalTxHash(txHash)) {
    throw new Error("Enter a valid DuskEVM withdrawal transaction hash.");
  }

  return asStatus(
    await withdrawals()
      .status(txHash, {
        proofGame,
        submitter: walletStore.getDuskEvmProofSubmitter(),
      })
      .catch(inWords)
  );
}

/**
 * How long a withdrawal takes on this network, as Dusk says: the Portal's
 * proof maturity and dispute game finality delays, and how often outputs
 * come.
 */
export const loadWithdrawalTiming = async () => withdrawals().timing();

/**
 * When the withdrawals an account proved can be claimed, by their hashes,
 * as the chain says: claimed, ready, a date, none, or to prove again.
 *
 * @param {`0x${string}`[]} hashes
 * @param {{ submitter: `0x${string}` }} options
 * @returns {Promise<Map<string, WithdrawalClaim>>}
 */
export const readWithdrawalClaims = async (hashes, { submitter }) =>
  withdrawals().claims(hashes, { submitter });

/**
 * @param {string} url
 * @param {string} method
 * @param {unknown[]} params
 */
async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`${method} failed with HTTP ${response.status}`);
  }

  const body = await response.json();

  if (body.error) {
    throw new Error(body.error.message ?? `${method} failed`);
  }

  return body.result;
}

/**
 * The time of a DuskEVM block, as an ISO string.
 *
 * @param {bigint} blockNumber
 */
export async function loadL2BlockTime(blockNumber) {
  const { l2RpcUrl } = requireWithdrawalFinalizationConfig();
  const block = await rpc(l2RpcUrl, "eth_getBlockByNumber", [
    toHex(blockNumber),
    false,
  ]);

  if (!block) {
    throw new Error(`L2 block ${blockNumber} is not available.`);
  }

  return new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString();
}

/**
 * @param {string} txHash
 */
export async function loadDuskTransactionExecution(txHash) {
  const normalizedHash = txHash.replace(/^0x/, "");

  if (!/^[0-9a-fA-F]{64}$/.test(normalizedHash)) {
    throw new Error("Dusk transaction hash is invalid.");
  }

  const network = await networkStore.connect();
  const result = await network.query(
    `tx(hash: "${normalizedHash.toLowerCase()}") { err blockHeight }`
  );

  if (!result?.tx) {
    return null;
  }

  return {
    blockHeight: BigInt(result.tx.blockHeight),
    error: result.tx.err ?? null,
  };
}

/**
 * A withdrawal's start on DuskEVM, for the EVM wallet to send: DuskEVM's
 * bridge's `bridgeETHTo`, paying `to` on Dusk: the bridge withdrawals are
 * read and checked against, as set for local work or the network's file's.
 *
 * @param {{ amountWei: bigint, sender: string, to: string }} withdrawal
 */
export const withdrawalStart = (withdrawal) =>
  withdrawalCall(/** @type {Network} */ (withdrawalNetwork()), withdrawal);

/**
 * The gas a proof or a claim is sent with: the limit the package worked
 * out for it, at the wallet's price, as set or the node's.
 *
 * @param {PortalCall} call
 */
const gasOf = ({ gasLimit }) =>
  new Gas({
    limit: gasLimit,
    price: get(settingsStore).customGasPrice ?? get(gasPriceStore),
  });

/**
 * Proofs whose claim date was shown, by the account they were made for and
 * withdrawal transaction, for a short while: the proof sent is then the one
 * the date was for, and only by that account.
 *
 * @type {Map<string, PreparedProof>}
 */
const preparedProofs = new Map();

/**
 * @param {`0x${string}`} submitter
 * @param {`0x${string}`} txHash
 */
const proofKey = (submitter, txHash) =>
  `${submitter.toLowerCase()} ${txHash.toLowerCase()}`;

/**
 * The proof of a withdrawal, and when it can be claimed if the proof is made
 * now: against a game that covers the withdrawal and has already resolved,
 * where there is one, so the date is exact; otherwise against the newest
 * game that covers it, and the date is the earliest.
 *
 * @param {`0x${string}`} txHash
 * @returns {Promise<PreparedProof>}
 */
export async function prepareProof(txHash) {
  const submitter = walletStore.getDuskEvmProofSubmitter();
  const prepared = await withdrawals()
    .prepareProof(txHash, {
      gasLimitUpper: get(gasStore).gasLimitUpper,
      submitter,
    })
    .catch(inWords);

  // Kept only with a date: one read again without leaves in place the proof
  // whose date is still shown.
  if (prepared.claim?.at) {
    preparedProofs.set(proofKey(submitter, txHash), prepared);
  }

  return prepared;
}

/**
 * When a withdrawal can be claimed if it's proved now; null when that can't
 * be read. The proof it's for is the one "Prove on Dusk" then sends.
 *
 * @param {`0x${string}`} txHash
 */
export const loadProveNowClaim = (txHash) =>
  prepareProof(txHash).then(({ claim }) => (claim?.at ? claim : null));

/**
 * Sends a proof or a claim from the wallet open as it begins: once it's
 * made, nothing goes out after another wallet opened, or a lock
 * (WalletChangedError).
 *
 * @returns {(call: PortalCall) => Promise<string>}
 */
function sendForThisWallet() {
  const send = walletStore.forThisWallet()(
    walletStore.sendDuskEvmWithdrawalCall
  );

  return async (call) => (await send(call, gasOf(call))).hash;
}

/**
 * Proves a withdrawal on Dusk: with the proof whose claim date was shown
 * when there's one from the last two minutes, or else a new one. It goes
 * out from the wallet open as it begins, or not at all.
 *
 * @param {`0x${string}`} txHash
 */
export async function proveWithdrawal(txHash) {
  const send = sendForThisWallet();
  const key = proofKey(walletStore.getDuskEvmProofSubmitter(), txHash);
  const kept = preparedProofs.get(key);
  const { call } =
    kept && Date.now() - kept.at < PREPARED_PROOF_MS
      ? kept
      : await prepareProof(txHash);

  preparedProofs.delete(key);

  return send(call);
}

/**
 * Claims a withdrawal on Dusk, once its status, read again, says it's
 * ready to claim for the wallet's account. It goes out from that wallet,
 * open as it begins, or not at all.
 *
 * @param {`0x${string}`} txHash
 */
export async function finalizeWithdrawal(txHash) {
  const send = sendForThisWallet();
  const call = await withdrawals()
    .claimCall(txHash, {
      gasLimitUpper: get(gasStore).gasLimitUpper,
      submitter: walletStore.getDuskEvmProofSubmitter(),
    })
    .catch(inWords);

  return send(call);
}
