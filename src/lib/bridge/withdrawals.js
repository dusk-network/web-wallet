import {
  bytesToHex,
  encodeAbiParameters,
  fromRlp,
  hexToBytes,
  keccak256,
  toHex,
  toRlp,
} from "viem";
import {
  L2_TO_L1_MESSAGE_PASSER_ADDRESS,
  parseMessagePassedReceipt,
  hashWithdrawal as sdkHashWithdrawal,
  serializeOutputRootProofForDuskAbi,
  serializeWithdrawalForDuskAbi,
} from "@dusk/evm-sdk";
import { Gas } from "@dusk/w3sper";
import { get } from "svelte/store";

import {
  GAME_STATUS,
  claimFrom,
  claimReadiness,
  contractClock,
  contractNow,
  isCandidateGame,
  isEligibleGame,
} from "@dusk-network/networks/duskevm";
import { withdrawalGasLimit } from "@dusk-network/networks/gas";
import { MAX_BATCH } from "@hdauven/dusk-multicall";
import {
  bridgeReads,
  hubClock,
  hubOfGame,
  hubOfType,
  knownHubOf,
  readGame,
  settle,
} from "$lib/bridge/bridgeReads";
import { WITHDRAWAL_GAS_REFUSAL } from "$lib/bridge/withdrawalLifecycle";
import {
  gasPriceStore,
  gasStore,
  networkStore,
  settingsStore,
  walletStore,
} from "$lib/stores";
import { duskEvm } from "$lib/web3/walletConnection";
import { duskEvmContractId, duskEvmDriverUrl } from "$lib/web3/duskEvm";
import { errorMessage } from "$lib/dusk/error";
import { normalizedTxHash } from "$lib/bridge/withdrawalActivityValues";

/**
 * @typedef {import("$lib/bridge/bridgeReads").BridgeReads} BridgeReads
 * @typedef {import("@dusk-network/networks/duskevm").ClaimDate} ClaimDate
 * @typedef {ClaimDate & { claimed: boolean, ready: boolean, reprove: boolean }} WithdrawalClaim
 *   When a proved withdrawal can be claimed, as the chain says, and whether
 *   it's claimed already or can be claimed now. `reprove` when its proof
 *   must be made again, as its game was blacklisted or the challenger won:
 *   it has no date then.
 */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = /** @type {`0x${string}`} */ (
  "0x0000000000000000000000000000000000000000000000000000000000000000"
);

/**
 * DuskEVM's contracts and drivers on Dusk come from the network's file
 * (`$lib/web3/duskEvm`); these set them instead, for local work. The
 * anchor state registry is the one the Portal asks whether a dispute game is
 * proper and respected: with it, a proof goes against a game that has
 * already resolved, so its claim date is exact. `none` leaves it out.
 */
const env = import.meta.env;

const VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH = parseGameSearchDepth(
  import.meta.env.VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH
);
/** The latest games read for how often outputs come: five gaps. */
const OUTPUT_SAMPLE = 6n;

/** Games searched for one already resolved, a page at a time, at most three pages. */
const RESOLVED_PAGE = 32n;
const RESOLVED_PAGES = 3;

/** Three reads a game: as many games as one Multicall for Dusk query holds. */
const CHECKED_PER_QUERY = Math.floor(MAX_BATCH / 3);

/** How far past a game's earliest resolution its resolver is usually done: 205 blocks at p90. */
const RESOLVER_LAG_SECONDS = 3_600n;

/** How long a proof whose claim date was shown is the one sent. */
const PREPARED_PROOF_MS = 120_000;

/** @param {unknown} value */
export function parseGameSearchDepth(value) {
  const parsed = Number(value ?? 64);

  return Number.isSafeInteger(parsed) && parsed > 0 ? BigInt(parsed) : 64n;
}

/**
 * @param {string | undefined} value
 * @returns {value is `0x${string}`}
 */
function isContractId(value) {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(value ?? "");
}

/**
 * @param {string | undefined} value
 */
function isConfiguredDataDriverUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  const trimmed = value.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:/iu.exec(trimmed)?.[0];

  return scheme === undefined || /^https?:$/iu.test(scheme);
}

/**
 * @param {string} value
 */
function strip0x(value) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

/**
 * @param {string} value
 */
function normalizeContractId(value) {
  return strip0x(value).toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {value is `0x${string}`}
 */
export function isWithdrawalTxHash(value) {
  return normalizedTxHash(value) !== null;
}

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

/**
 * @param {unknown} error
 */
function asError(error) {
  return error instanceof Error ? error : new Error(errorMessage(error));
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

  return Object.freeze({
    anchorStateRegistryContractId: config.anchorStateRegistryContractId,
    disputeGameFactoryContractId: /** @type {string} */ (
      config.disputeGameFactoryContractId
    ),
    disputeGameFactoryDataDriverUrl: /** @type {string} */ (
      config.disputeGameFactoryDataDriverUrl
    ),
    l2RpcUrl: config.l2RpcUrl,
    optimismPortalContractId: /** @type {string} */ (
      config.optimismPortalContractId
    ),
    optimismPortalDataDriverUrl: /** @type {string} */ (
      config.optimismPortalDataDriverUrl
    ),
  });
}

/**
 * The bridge's contracts on Dusk, read through Multicall for Dusk.
 *
 * @param {{
 *   fetch?: typeof fetch,
 *   loadDriver?: (url: string) => Promise<BridgeDriver>,
 *   nodeUrl?: string,
 * }} [options]
 * @returns {BridgeReads}
 */
function contractReads(options = {}) {
  return bridgeReads({
    ...options,
    config: requireWithdrawalFinalizationConfig(),
  });
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function bytesLikeToArray(value) {
  if (typeof value === "string") {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
      throw new TypeError("Expected 0x-prefixed byte hex");
    }

    return Array.from(hexToBytes(/** @type {`0x${string}`} */ (value)));
  }

  if (value instanceof Uint8Array) {
    return Array.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }

  if (Array.isArray(value)) {
    return value.map((byte) => Number(byte));
  }

  throw new TypeError("Expected byte array or hex string");
}

/**
 * @param {unknown} value
 * @param {number | undefined} expectedLength
 */
function fixedBytes(value, expectedLength) {
  const bytes = bytesLikeToArray(value);

  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new RangeError(
      `Expected ${expectedLength} bytes, got ${bytes.length}`
    );
  }

  return bytes;
}

/**
 * @param {unknown} value
 * @returns {`0x${string}`}
 */
function bytes32ToHex(value) {
  return /** @type {`0x${string}`} */ (
    bytesToHex(Uint8Array.from(fixedBytes(value, 32)))
  );
}

/**
 * @param {unknown} value
 * @returns {`0x${string}`}
 */
function evmAddressToHex(value) {
  return /** @type {`0x${string}`} */ (
    bytesToHex(Uint8Array.from(fixedBytes(value, 20)))
  );
}

/**
 * @param {bigint | number} value
 * @returns {number[]}
 */
function bigIntToU256(value) {
  let remaining = BigInt(value);

  if (remaining < 0n) {
    throw new RangeError("U256 cannot be negative");
  }

  const bytes = new Array(32).fill(0);

  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  if (remaining !== 0n) {
    throw new RangeError("Value does not fit in U256");
  }

  return bytes;
}

/**
 * @param {unknown} value
 */
function u256ToBigInt(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (typeof value === "string") {
    return BigInt(value);
  }

  let out = 0n;

  for (const byte of fixedBytes(value, 32)) {
    out = (out << 8n) + BigInt(byte);
  }

  return out;
}

/**
 * @param {unknown} value
 */
function isZeroU256(value) {
  return u256ToBigInt(value) === 0n;
}

/**
 * @param {`0x${string}`} value
 * @param {number | undefined} expectedLength
 */
function hexToArray(value, expectedLength) {
  return fixedBytes(value, expectedLength);
}

/**
 * @param {object} withdrawal
 * @param {`0x${string}`} withdrawal.data
 * @param {bigint} withdrawal.gasLimit
 * @param {bigint} withdrawal.nonce
 * @param {`0x${string}`} withdrawal.sender
 * @param {`0x${string}`} withdrawal.target
 * @param {bigint} withdrawal.value
 */
function withdrawalToDriverInput(withdrawal) {
  const encoded = serializeWithdrawalForDuskAbi(withdrawal);

  return {
    data: hexToArray(encoded.data, undefined),
    ["gas_limit"]: hexToArray(encoded.gas_limit, 32),
    nonce: hexToArray(encoded.nonce, 32),
    sender: hexToArray(encoded.sender, 20),
    target: hexToArray(encoded.target, 20),
    value: hexToArray(encoded.value, 32),
  };
}

/**
 * @param {object} outputRootProof
 * @param {`0x${string}`} outputRootProof.latestBlockhash
 * @param {`0x${string}`} outputRootProof.messagePasserStorageRoot
 * @param {`0x${string}`} outputRootProof.stateRoot
 * @param {`0x${string}`} outputRootProof.version
 */
function outputRootProofToDriverInput(outputRootProof) {
  const encoded = serializeOutputRootProofForDuskAbi(outputRootProof);

  return {
    ["latest_blockhash"]: hexToArray(encoded.latest_blockhash, 32),
    ["message_passer_storage_root"]: hexToArray(
      encoded.message_passer_storage_root,
      32
    ),
    ["state_root"]: hexToArray(encoded.state_root, 32),
    version: hexToArray(encoded.version, 32),
  };
}

/**
 * @param {string} url
 * @param {string} method
 * @param {unknown[]} params
 */
async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "content-type": "application/json",
    },
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
 * @param {`0x${string}`} txHash
 */
async function fetchL2Receipt(txHash) {
  const config = requireWithdrawalFinalizationConfig();

  return await rpc(config.l2RpcUrl, "eth_getTransactionReceipt", [txHash]);
}

/**
 * @param {any} receipt
 * @returns {import("@dusk/evm-sdk").ParsedWithdrawalMessage & {blockNumber: bigint}}
 */
export function parseWithdrawalReceipt(receipt) {
  if (!receipt) {
    throw new Error("Withdrawal transaction was not found.");
  }

  if (receipt.status === "0x0") {
    throw new Error("Withdrawal transaction failed on DuskEVM.");
  }

  try {
    const parsed = parseMessagePassedReceipt(receipt);

    if (parsed.blockNumber === undefined) {
      throw new Error("Withdrawal receipt is missing its L2 block number.");
    }

    return /** @type {import("@dusk/evm-sdk").ParsedWithdrawalMessage & {blockNumber: bigint}} */ (
      parsed
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "No MessagePassed event found in receipt"
    ) {
      throw new Error("Withdrawal MessagePassed event was not found.", {
        cause: error,
      });
    }

    throw error;
  }
}

export const hashWithdrawal = sdkHashWithdrawal;

/**
 * @param {`0x${string}`} withdrawalHash
 */
export function withdrawalStorageKey(withdrawalHash) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [withdrawalHash, 0n]
    )
  );
}

/**
 * @param {object} outputRootProof
 * @param {`0x${string}`} outputRootProof.latestBlockhash
 * @param {`0x${string}`} outputRootProof.messagePasserStorageRoot
 * @param {`0x${string}`} outputRootProof.stateRoot
 * @param {`0x${string}`} outputRootProof.version
 */
export function hashOutputRootProof(outputRootProof) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        outputRootProof.version,
        outputRootProof.stateRoot,
        outputRootProof.messagePasserStorageRoot,
        outputRootProof.latestBlockhash,
      ]
    )
  );
}

/**
 * @param {bigint} blockNumber
 */
async function getL2Block(blockNumber) {
  const config = requireWithdrawalFinalizationConfig();
  const block = await rpc(config.l2RpcUrl, "eth_getBlockByNumber", [
    toHex(blockNumber),
    false,
  ]);

  if (!block) {
    throw new Error(`L2 block ${blockNumber} is not available.`);
  }

  return block;
}

/**
 * The time of a DuskEVM block, as an ISO string.
 *
 * @param {bigint} blockNumber
 */
export async function loadL2BlockTime(blockNumber) {
  const block = await getL2Block(blockNumber);

  return new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString();
}

/**
 * @param {`0x${string}`} withdrawalHash
 * @param {bigint} blockNumber
 */
async function getWithdrawalProof(withdrawalHash, blockNumber) {
  const config = requireWithdrawalFinalizationConfig();
  const key = withdrawalStorageKey(withdrawalHash);
  const proof = await rpc(config.l2RpcUrl, "eth_getProof", [
    L2_TO_L1_MESSAGE_PASSER_ADDRESS,
    [key],
    toHex(blockNumber),
  ]);

  const storageProof = proof?.storageProof?.[0];
  const nodes = storageProof?.proof;

  if (!proof?.storageHash || !Array.isArray(nodes)) {
    throw new Error("Withdrawal storage proof is not available.");
  }

  return {
    nodes: maybeAddProofNode(keccak256(key), nodes),
    storageRoot: proof.storageHash,
  };
}

/**
 * @param {any} item
 * @returns {{ node: any[], rlp: `0x${string}` } | null}
 */
function embeddedProofNode(item) {
  if (Array.isArray(item)) {
    return {
      node: item,
      rlp: toRlp(item),
    };
  }

  if (typeof item !== "string" || !item.startsWith("0x") || item === "0x") {
    return null;
  }

  try {
    const rlp = /** @type {`0x${string}`} */ (item);
    const decoded = fromRlp(rlp);

    return Array.isArray(decoded)
      ? {
          node: decoded,
          rlp,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {any[]} node
 */
function proofNodePathSuffix(node) {
  const path = node[0];

  return typeof path === "string" ? path.slice(3) : null;
}

/**
 * OP Stack clients append embedded terminal nodes when the storage proof ends
 * in a branch node. Dusk's portal proof verifier follows the same MPT shape.
 *
 * @param {`0x${string}`} key
 * @param {readonly `0x${string}`[]} proof
 */
export function maybeAddProofNode(key, proof) {
  const lastProofRlp = proof[proof.length - 1];
  const lastProof = fromRlp(lastProofRlp);

  if (!Array.isArray(lastProof) || lastProof.length !== 17) {
    return proof;
  }

  const modifiedProof = [...proof];

  for (const item of lastProof) {
    const embedded = embeddedProofNode(item);

    if (embedded === null) {
      continue;
    }

    const suffix = proofNodePathSuffix(embedded.node);

    if (suffix === null || !key.endsWith(suffix)) {
      continue;
    }

    modifiedProof.push(embedded.rlp);
  }

  return modifiedProof;
}

/**
 * @param {any} value
 * @param {string} key
 * @param {number} index
 */
function tupleValue(value, key, index) {
  return value?.[key] ?? value?.[index];
}

/**
 * @param {unknown} extraData
 */
function l2SequenceFromExtraData(extraData) {
  const bytes = bytesLikeToArray(extraData);

  if (bytes.length < 32) {
    return 0n;
  }

  return u256ToBigInt(bytes.slice(0, 32));
}

/**
 * @param {import("$lib/bridge/bridgeReads").ContractReads} dgf
 * @param {number} gameType
 * @param {bigint} start
 * @param {bigint} pageSize
 */
async function readLatestGames(dgf, gameType, start, pageSize) {
  return await dgf.call.findLatestGames([
    gameType,
    bigIntToU256(start),
    bigIntToU256(pageSize),
  ]);
}

/**
 * @param {import("$lib/bridge/bridgeReads").ContractReads} dgf
 * @param {bigint} index
 */
async function readGameMetadata(dgf, index) {
  return await dgf.call.gameMetadataAtIndex(bigIntToU256(index));
}

/**
 * @param {import("$lib/bridge/bridgeReads").ContractReads} dgf
 * @param {bigint} index
 */
async function readGameAtIndex(dgf, index) {
  return await dgf.call.gameAtIndex(bigIntToU256(index));
}

/**
 * @param {any} metadata
 */
function gameL2BlockNumber(metadata) {
  const extraData = tupleValue(metadata, "extraData", 3);
  const explicitL2Sequence = tupleValue(metadata, "l2SequenceNumber", 2);

  return isZeroU256(explicitL2Sequence)
    ? l2SequenceFromExtraData(extraData)
    : u256ToBigInt(explicitL2Sequence);
}

/**
 * @param {`0x${string}`} withdrawalHash
 * @param {bigint} l2BlockNumber
 */
async function buildWithdrawalOutputProof(withdrawalHash, l2BlockNumber) {
  const block = await getL2Block(l2BlockNumber);
  const withdrawalProof = await getWithdrawalProof(
    withdrawalHash,
    l2BlockNumber
  );
  const outputRootProof = {
    latestBlockhash: block.hash,
    messagePasserStorageRoot: withdrawalProof.storageRoot,
    stateRoot: block.stateRoot,
    version: ZERO_HASH,
  };

  return {
    outputRoot: hashOutputRootProof(outputRootProof),
    outputRootProof,
    withdrawalProof: withdrawalProof.nodes,
  };
}

/**
 * @param {object} options
 * @param {import("$lib/bridge/bridgeReads").ContractReads} options.dgf
 * @param {any} options.game
 * @param {bigint} options.withdrawalBlockNumber
 * @param {`0x${string}`} options.withdrawalHash
 */
async function proofForCandidateGame({
  dgf,
  game,
  withdrawalBlockNumber,
  withdrawalHash,
}) {
  const index = u256ToBigInt(tupleValue(game, "index", 0));
  const metadata = await readGameMetadata(dgf, index);
  const rootClaim = bytes32ToHex(tupleValue(metadata, "rootClaim", 0));
  const l2BlockNumber = gameL2BlockNumber(metadata);

  if (l2BlockNumber < withdrawalBlockNumber) {
    return null;
  }

  const proof = await buildWithdrawalOutputProof(withdrawalHash, l2BlockNumber);

  if (proof.outputRoot.toLowerCase() !== rootClaim.toLowerCase()) {
    return null;
  }

  const gameAtIndex = await readGameAtIndex(dgf, index);

  return {
    ...proof,
    disputeGameIndex: index,
    disputeGameProxy: evmAddressToHex(tupleValue(gameAtIndex, "gameProxy", 2)),
    l2BlockNumber,
  };
}

/**
 * @param {object} options
 * @param {import("$lib/bridge/bridgeReads").ContractReads} options.dgf
 * @param {ReadonlyArray<any>} options.games
 * @param {bigint} options.withdrawalBlockNumber
 * @param {`0x${string}`} options.withdrawalHash
 */
async function findProofInGames({
  dgf,
  games,
  withdrawalBlockNumber,
  withdrawalHash,
}) {
  /** @type {Error | null} */
  let lastError = null;

  for (const game of games) {
    try {
      const proof = await proofForCandidateGame({
        dgf,
        game,
        withdrawalBlockNumber,
        withdrawalHash,
      });

      if (proof) {
        return { lastError, proof };
      }
    } catch (error) {
      lastError = asError(error);
    }
  }

  return { lastError, proof: null };
}

/**
 * @param {ReadonlyArray<any>} games
 * @param {bigint} remaining
 */
function nextGamePage(games, remaining) {
  const oldestIndex = u256ToBigInt(
    tupleValue(games[games.length - 1], "index", 0)
  );

  return {
    done: oldestIndex === 0n,
    remaining: remaining - BigInt(games.length),
    start: oldestIndex === 0n ? 0n : oldestIndex - 1n,
  };
}

/**
 * @param {bigint} remaining
 */
function gameSearchPageSize(remaining) {
  return remaining > 32n ? 32n : remaining;
}

/**
 * @param {object} options
 * @param {import("$lib/bridge/bridgeReads").ContractReads} options.dgf
 * @param {number} options.gameType
 * @param {bigint} options.remaining
 * @param {bigint} options.start
 * @param {bigint} options.withdrawalBlockNumber
 * @param {`0x${string}`} options.withdrawalHash
 */
async function scanGamePages(options) {
  let { remaining, start } = options;
  /** @type {Error | null} */
  let lastError = null;

  while (remaining > 0n) {
    const games = await readLatestGames(
      options.dgf,
      options.gameType,
      start,
      gameSearchPageSize(remaining)
    );

    if (!games.length) {
      break;
    }

    const result = await findProofInGames({ ...options, games });

    if (result.proof) {
      return result;
    }

    lastError = result.lastError ?? lastError;

    const next = nextGamePage(games, remaining);

    start = next.start;
    remaining = next.done ? 0n : next.remaining;
  }

  return { lastError, proof: null };
}

/**
 * A game as a search lists it: its index, creation time, address, root claim
 * and DuskEVM block.
 *
 * @param {any} result
 */
function searchedGame(result) {
  const metadata = fixedBytes(tupleValue(result, "metadata", 1), 32);

  return {
    createdAt: BigInt(tupleValue(result, "timestamp", 2)),
    index: u256ToBigInt(tupleValue(result, "index", 0)),
    l2BlockNumber: l2SequenceFromExtraData(tupleValue(result, "extra_data", 4)),
    // A game ID packs its type, its creation time, then its address.
    proxy: evmAddressToHex(metadata.slice(12)),
    rootClaim: bytes32ToHex(tupleValue(result, "root_claim", 3)),
  };
}

/**
 * The withdrawal's proof against the first of `games` it matches: its output
 * root is the game's root claim. `stop` when DuskEVM no longer gives a
 * block's proof: an older game's won't come either.
 *
 * @param {ReturnType<typeof searchedGame>[]} games
 * @param {`0x${string}`} withdrawalHash
 * @returns {Promise<{ proof?: any, stop?: boolean }>}
 */
async function proofAgainst(games, withdrawalHash) {
  for (const game of games) {
    try {
      const proof = await buildWithdrawalOutputProof(
        withdrawalHash,
        game.l2BlockNumber
      );

      if (proof.outputRoot.toLowerCase() === game.rootClaim.toLowerCase()) {
        return {
          proof: {
            ...proof,
            disputeGameIndex: game.index,
            disputeGameProxy: game.proxy,
            l2BlockNumber: game.l2BlockNumber,
          },
        };
      }
    } catch {
      return { stop: true };
    }
  }

  return {};
}

/**
 * The first of `games` that covers the withdrawal, has resolved for its
 * proposal, and that the Portal would take a proof against, with the
 * withdrawal's proof against it. The Portal asks the anchor state registry:
 * the game must be proper (registered, not blacklisted, not retired) and
 * respected. Games created at or before the respected game type last
 * changed are passed over too. Each game's status and the registry's two
 * answers go to the node a query at a time, newest first, until one passes.
 *
 * @param {ReturnType<typeof searchedGame>[]} games
 * @param {{ hubId: string, reads: BridgeReads, updatedAt: bigint, withdrawalBlockNumber: bigint, withdrawalHash: `0x${string}` }} options
 * @returns {Promise<{ proof?: any, stop?: boolean }>}
 */
async function resolvedProofIn(
  games,
  { hubId, reads, updatedAt, withdrawalBlockNumber, withdrawalHash }
) {
  const registry =
    /** @type {import("$lib/bridge/bridgeReads").ContractReads} */ (
      reads.registry
    );
  const rules = {
    respectedGameTypeUpdatedAt: updatedAt,
    withdrawalBlockNumber,
  };
  const candidates = games.filter((game) => isCandidateGame(game, rules));

  for (let from = 0; from < candidates.length; from += CHECKED_PER_QUERY) {
    const batch = candidates.slice(from, from + CHECKED_PER_QUERY);
    // Started together, they go in one query.
    const checked = await Promise.all(
      batch.map((game) => {
        const address = hexToArray(game.proxy, 20);

        return Promise.all([
          reads
            .hub(hubId)
            .call.statusForGame(address)
            .then(Number, () => null),
          registry.call.isGameProper(address).then(Boolean, () => null),
          registry.call.isGameRespected(address).then(Boolean, () => null),
        ]).then(([status, proper, respected]) => ({
          ...game,
          proper,
          respected,
          status,
        }));
      })
    );
    const found = await proofAgainst(
      checked.filter((game) => isEligibleGame(game, rules)),
      withdrawalHash
    );

    if (found.proof || found.stop) {
      return found;
    }
  }

  return {};
}

/**
 * Where to look for games old enough to have resolved: back from the newest
 * by the time since `cutoff`, at the pace games come. Other game types share
 * the factory's index.
 *
 * @param {ReturnType<typeof searchedGame>[]} newest
 * @param {bigint} cutoff
 */
function resolvedSearchStart(newest, cutoff) {
  const first = newest[0];
  const last = newest[newest.length - 1];
  const pace =
    (first.createdAt - last.createdAt) / (first.index - last.index || 1n) || 1n;
  const back =
    first.createdAt > cutoff
      ? (first.createdAt - cutoff + pace - 1n) / pace
      : 0n;

  return first.index > back ? first.index - back : 0n;
}

/**
 * A game covering the withdrawal that has already resolved for its
 * proposal, and that the Portal would take a proof against: a proof against
 * it can be claimed exactly its maturity delay later. Games come at a steady
 * pace, so the search starts about where games are old enough to have
 * resolved, and goes back a few pages. Null when none covers the withdrawal
 * yet, none of them has resolved and passes, or the anchor state registry
 * isn't known.
 *
 * @param {{
 *   gameCount: bigint,
 *   gameType: number,
 *   reads: BridgeReads,
 *   tip: import("@dusk-network/networks/duskevm").DuskTip,
 *   withdrawalBlockNumber: bigint,
 *   withdrawalHash: `0x${string}`,
 * }} options
 */
async function findResolvedProof({
  gameCount,
  gameType,
  reads,
  tip,
  withdrawalBlockNumber,
  withdrawalHash,
}) {
  // Without the registry the Portal asks, which games it takes can't be
  // told: the proof then goes against the newest game covering the
  // withdrawal.
  if (!reads.registry) {
    return null;
  }

  /** @param {bigint} from */
  const page = async (from) =>
    /** @type {any[]} */ (
      await readLatestGames(reads.dgf, gameType, from, RESOLVED_PAGE)
    ).map(searchedGame);
  const [hubId, newest, updatedAt] = await Promise.all([
    hubOfType(reads, gameType),
    page(gameCount - 1n),
    reads.registry.call.respectedGameTypeUpdatedAt().then(BigInt),
  ]);

  if (newest.length < 2) {
    return null;
  }

  // Its clock ran out, and its resolver's usual lag has passed.
  const cutoff =
    contractNow(contractClock(newest[0].createdAt, tip), tip) -
    (await hubClock(reads, hubId)) -
    RESOLVER_LAG_SECONDS;

  return await searchResolvedPages(page, resolvedSearchStart(newest, cutoff), {
    cutoff,
    hubId,
    reads,
    updatedAt,
    withdrawalBlockNumber,
    withdrawalHash,
  });
}

/**
 * Pages of games from `from` back, at most RESOLVED_PAGES, for one old
 * enough to have resolved that covers the withdrawal.
 *
 * @param {(from: bigint) => Promise<ReturnType<typeof searchedGame>[]>} page
 * @param {bigint} from
 * @param {{ cutoff: bigint, hubId: string, reads: BridgeReads, updatedAt: bigint, withdrawalBlockNumber: bigint, withdrawalHash: `0x${string}` }} options
 */
async function searchResolvedPages(page, from, { cutoff, ...options }) {
  let start = from;

  for (let pages = 0; pages < RESOLVED_PAGES; pages += 1) {
    const games = await page(start);
    const old = games.filter((game) => game.createdAt <= cutoff);

    // The newest of them doesn't cover the withdrawal: none does.
    if (old.length && old[0].l2BlockNumber < options.withdrawalBlockNumber) {
      return null;
    }

    const found = await resolvedProofIn(old, options);

    if (found.proof || found.stop) {
      return found.proof ?? null;
    }

    if (!games.length || games[games.length - 1].index === 0n) {
      break;
    }

    start = games[games.length - 1].index - 1n;
  }

  return null;
}

/**
 * The game to prove the withdrawal against, with its proof: the newest game
 * covering it, or with `preferResolved` (`{ tip }`) one that has already
 * resolved, where there is one, so the claim date is exact when the proof is
 * made. The factory's game count and the Portal's game type go in one query.
 *
 * @param {object} options
 * @param {{ tip: import("@dusk-network/networks/duskevm").DuskTip } | null} [options.preferResolved]
 * @param {BridgeReads} [options.reads]
 * @param {bigint} options.withdrawalBlockNumber
 * @param {`0x${string}`} options.withdrawalHash
 */
async function lookupWithdrawalProof({
  preferResolved = null,
  reads = contractReads(),
  withdrawalBlockNumber,
  withdrawalHash,
}) {
  const [count, type] = await Promise.all([
    reads.dgf.call.gameCount(),
    reads.portal.call.respectedGameType(),
  ]);
  const gameCount = u256ToBigInt(count);
  const gameType = Number(type);

  if (gameCount === 0n) {
    return {
      lastError: new Error("No dispute games have been proposed yet."),
      proof: null,
    };
  }

  if (preferResolved) {
    const resolved = await findResolvedProof({
      gameCount,
      gameType,
      reads,
      tip: preferResolved.tip,
      withdrawalBlockNumber,
      withdrawalHash,
    }).catch(() => null);

    if (resolved) {
      return { lastError: null, proof: resolved };
    }
  }

  const result = await scanGamePages({
    dgf: reads.dgf,
    gameType,
    remaining: VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH,
    start: gameCount - 1n,
    withdrawalBlockNumber,
    withdrawalHash,
  });

  if (result.proof) {
    return result;
  }

  return {
    lastError:
      result.lastError ??
      new Error(
        "No finalized output proposal covering this withdrawal is ready yet."
      ),
    proof: null,
  };
}

/**
 * @param {Parameters<typeof lookupWithdrawalProof>[0]} options
 */
async function findWithdrawalProof(options) {
  const result = await lookupWithdrawalProof(options);

  if (result.proof) {
    return result.proof;
  }

  throw result.lastError;
}

/**
 * @typedef {{
 *   blacklisted: { error?: Error, value?: boolean },
 *   game: { error?: Error, value?: Awaited<ReturnType<typeof readGame>> },
 * }} ProvenGameRead
 */

/**
 * A proven game as its hub gives it, and whether the Portal blacklisted it,
 * started together so that they go in one query.
 *
 * @param {BridgeReads} reads
 * @param {string} hubId
 * @param {`0x${string}`} proxy
 * @returns {Promise<ProvenGameRead>}
 */
const readProvenGame = (reads, hubId, proxy) =>
  Promise.all([
    settle(readGame(reads, hubId, proxy)),
    settle(reads.portal.call.disputeGameBlacklist(hexToArray(proxy, 20))),
  ]).then(([game, blacklisted]) => ({ blacklisted, game }));

/**
 * The Portal's record of a withdrawal for the account that proves and claims
 * it, its delays, and its own check of a claim now, read together: through
 * Multicall for Dusk they're one query. The game this account proved against
 * at the last check (`proofGame`) goes in the same query, once its hub was
 * read.
 *
 * @param {BridgeReads} reads
 * @param {`0x${string}`} withdrawalHash
 * @param {`0x${string}`} submitter
 * @param {`0x${string}` | null} proofGame
 */
function readPortalState(reads, withdrawalHash, submitter, proofGame) {
  const hash = hexToArray(withdrawalHash, 32);
  const account = hexToArray(submitter, 20);
  const hubId = proofGame ? knownHubOf(reads, proofGame) : null;
  const ahead =
    hubId && proofGame
      ? {
          game: proofGame.toLowerCase(),
          reads: readProvenGame(reads, hubId, proofGame),
        }
      : null;

  return Promise.all([
    reads.portal.call.finalizedWithdrawals(hash),
    reads.portal.call.numProofSubmitters(hash),
    reads.portal.call.provenWithdrawals([hash, account]),
    reads.portal.call.proofMaturityDelaySeconds(),
    reads.portal.call.disputeGameFinalityDelaySeconds(),
    settle(reads.portal.call.checkWithdrawal([hash, account])),
  ]).then(([finalized, count, proven, maturity, finality, check]) => ({
    ahead,
    check,
    finalized: Boolean(finalized),
    portal: {
      disputeGameFinalityDelaySeconds: u256ToBigInt(finality),
      proofMaturityDelaySeconds: u256ToBigInt(maturity),
    },
    proofSubmitterCount: u256ToBigInt(count),
    proven: {
      disputeGameProxy: evmAddressToHex(
        tupleValue(proven, "disputeGameProxy", 0)
      ),
      timestamp: BigInt(tupleValue(proven, "timestamp", 1)),
    },
  }));
}

/**
 * A claim's date as a withdrawal's status keeps it: wall-clock seconds.
 *
 * @param {import("@dusk-network/networks/duskevm").ClaimReadiness} readiness
 */
const claimDates = ({ claimOverdue, readyAt, readyAtExact }) => ({
  claimOverdue,
  readyAt,
  readyAtExact,
});

/**
 * A proof the Portal won't take: proved again against a newer game where
 * there is one.
 *
 * @param {any} event
 * @param {BridgeReads} reads
 * @param {`0x${string}`} proxy The game of the proof refused
 */
async function replacementStatus(event, reads, proxy) {
  const proofAvailability = await lookupWithdrawalProof({
    reads,
    withdrawalBlockNumber: event.blockNumber,
    withdrawalHash: event.withdrawalHash,
  });
  const undated = { claimOverdue: false, readyAt: null, readyAtExact: false };

  if (
    proofAvailability.proof &&
    proofAvailability.proof.disputeGameProxy.toLowerCase() !==
      proxy.toLowerCase()
  ) {
    return {
      ...undated,
      proofRejected: false,
      stage: "ready_to_prove",
      statusMessage:
        "The existing proof is not accepted by the portal, and a newer output proposal is available. Prove the withdrawal again.",
    };
  }

  return {
    ...undated,
    proofRejected: true,
    stage: "proven_waiting",
    statusMessage:
      "The existing proof was rejected, but no replacement output proposal is available yet.",
  };
}

/**
 * A proof that waits: until its date, or, with the date passed and the
 * Portal still refusing the claim, with no date, as it says nothing more. A
 * game that couldn't be read leaves the date known so far (no `readyAt`).
 *
 * @param {import("@dusk-network/networks/duskevm").ClaimReadiness | null} readiness
 * @param {{ status: number } | null} game
 */
function waitingStatus(readiness, game) {
  if (!readiness || !game) {
    return {
      proofRejected: false,
      stage: "proven_waiting",
      statusMessage:
        "The proof is accepted, but its dispute game can't be read right now.",
    };
  }

  if (readiness.refused) {
    return {
      ...claimDates(readiness),
      proofRejected: false,
      stage: "proven_waiting",
      statusMessage: "The Portal doesn't take the claim yet.",
    };
  }

  return {
    ...claimDates(readiness),
    proofRejected: false,
    stage: "proven_waiting",
    statusMessage:
      game.status === GAME_STATUS.IN_PROGRESS
        ? "The proof is accepted. Its dispute game is still in progress."
        : "The proof is accepted. Wait for its dispute game to become final.",
  };
}

/**
 * When a proven withdrawal can be claimed, and whether it can be now: once
 * the Portal takes the claim and its date has come. A Portal whose check
 * takes just the proof and its game says yes before the date, and refuses
 * the claim itself. Null without its game or Dusk's latest block.
 *
 * @param {{
 *   claimable: boolean,
 *   game: import("@dusk-network/networks/duskevm").ClaimGame | null,
 *   state: Awaited<ReturnType<typeof readPortalState>>,
 *   tip: import("@dusk-network/networks/duskevm").DuskTip | null,
 * }} proof
 */
function readinessOf({ claimable, game, state, tip }) {
  if (!game || !tip) {
    return null;
  }

  const { timestamp } = state.proven;

  return claimReadiness({
    claim: claimFrom({
      clock: contractClock(timestamp, tip),
      game,
      portal: state.portal,
      provenAt: timestamp,
      tip,
    }),
    portalAccepts: claimable,
    tip,
  });
}

/**
 * A proven withdrawal's stage and claim date. The proof's game is read on
 * its own hub, as the Portal reads it, with whether it's blacklisted; the
 * Portal's own check says whether it can be claimed now. A proof time on
 * testnet's height clock is converted, not dropped.
 *
 * @param {any} event
 * @param {{
 *   reads: BridgeReads,
 *   state: Awaited<ReturnType<typeof readPortalState>>,
 *   tip: import("@dusk-network/networks/duskevm").DuskTip | null,
 * }} options
 */
async function provenStatus(event, { reads, state, tip }) {
  const { disputeGameProxy: proxy } = state.proven;
  /** @type {ProvenGameRead} */
  const read =
    state.ahead?.game === proxy.toLowerCase()
      ? await state.ahead.reads
      : await hubOfGame(reads, proxy).then(
          (hubId) => readProvenGame(reads, hubId, proxy),
          (/** @type {Error} */ error) => ({
            blacklisted: { error },
            game: { error },
          })
        );
  const game = read.game.value ?? null;
  const claimable = !state.check.error;

  if (
    !claimable &&
    proofRequiresReplacement({
      gameStatus: game?.status ?? GAME_STATUS.IN_PROGRESS,
      isGameBlacklisted: read.blacklisted.value === true,
    })
  ) {
    return replacementStatus(event, reads, proxy);
  }

  const readiness = readinessOf({ claimable, game, state, tip });

  // With no date known, the Portal's yes counts.
  return claimable && (readiness?.ready ?? true)
    ? {
        ...(readiness ? claimDates(readiness) : {}),
        proofRejected: false,
        stage: "ready_to_finalize",
        statusMessage: "",
      }
    : waitingStatus(readiness, game);
}

/**
 * A withdrawal no proof of this account's covers yet: ready to prove once a
 * game covers it.
 *
 * @param {any} event
 * @param {BridgeReads} reads
 */
async function unprovenStatus(event, reads) {
  const proofAvailability = await lookupWithdrawalProof({
    reads,
    withdrawalBlockNumber: event.blockNumber,
    withdrawalHash: event.withdrawalHash,
  });

  if (!proofAvailability.proof) {
    return {
      ...event,
      stage: "waiting_for_output",
      statusMessage: errorMessage(proofAvailability.lastError),
    };
  }

  return {
    ...event,
    disputeGameIndex: proofAvailability.proof.disputeGameIndex,
    proofL2BlockNumber: proofAvailability.proof.l2BlockNumber,
    stage: "ready_to_prove",
  };
}

/**
 * Where a withdrawal is, for the account that proves and claims it
 * (`submitter`): claimed, waiting for a game, ready to prove, waiting for
 * its claim date, or ready to claim. The latest block is read with the
 * Portal: a proof's dates are counted from it.
 *
 * @param {any} event The withdrawal, as its DuskEVM receipt has it
 * @param {{ proofGame?: `0x${string}` | null, reads: BridgeReads, submitter: `0x${string}` }} options
 */
async function withdrawalStatus(event, { proofGame = null, reads, submitter }) {
  const tip = settle(networkStore.getLatestBlock());
  const state = await readPortalState(
    reads,
    event.withdrawalHash,
    submitter,
    proofGame
  );

  if (state.finalized) {
    return { ...event, stage: "finalized" };
  }

  if (state.proofSubmitterCount === 0n) {
    return { ...(await unprovenStatus(event, reads)), proofSubmitterCount: 0n };
  }

  const { proven } = state;
  const base = {
    proofSubmitter: submitter,
    proofSubmitterCount: state.proofSubmitterCount,
  };

  if (proven.timestamp === 0n || proven.disputeGameProxy === ZERO_ADDRESS) {
    return { ...(await unprovenStatus(event, reads)), ...base };
  }

  return {
    ...event,
    ...base,
    disputeGameProxy: proven.disputeGameProxy,
    ...(await provenStatus(event, {
      reads,
      state,
      tip: (await tip).value ?? null,
    })),
  };
}

/**
 * @param {object} disposition
 * @param {number} disposition.gameStatus
 * @param {boolean} disposition.isGameBlacklisted
 */
export function proofRequiresReplacement(disposition) {
  return (
    disposition.isGameBlacklisted ||
    disposition.gameStatus === GAME_STATUS.CHALLENGER_WINS
  );
}

/**
 * Where a withdrawal is, by its DuskEVM transaction, for the wallet's
 * account. `proofGame`, the game its last check found it proved against,
 * puts the game's reads in the same query as the Portal's.
 *
 * @param {`0x${string}`} txHash
 * @param {{ proofGame?: `0x${string}` | null, reads?: BridgeReads }} [options]
 */
export async function loadWithdrawalStatus(
  txHash,
  { proofGame = null, reads = contractReads() } = {}
) {
  if (!isWithdrawalTxHash(txHash)) {
    throw new Error("Enter a valid DuskEVM withdrawal transaction hash.");
  }

  const receipt = await fetchL2Receipt(txHash);
  const event = parseWithdrawalReceipt(receipt);

  return await withdrawalStatus(event, {
    proofGame,
    reads,
    submitter: walletStore.getDuskEvmProofSubmitter(),
  });
}

/**
 * How long a withdrawal takes on this network, as Dusk says: the Portal's
 * proof maturity and dispute game finality delays, and how often outputs
 * come, the middle gap between the latest games of the type the Portal
 * takes. The reads go through Multicall for Dusk: the delays with the game
 * count in one query, then the games.
 *
 * @param {{
 *   fetch?: typeof fetch,
 *   loadDriver?: (url: string) => Promise<BridgeDriver>,
 *   nodeUrl?: string,
 * }} [options]
 */
export async function loadWithdrawalTiming(options = {}) {
  const reads = contractReads(options);
  const [maturity, finality, gameType, count] = await Promise.all([
    reads.portal.call.proofMaturityDelaySeconds(),
    reads.portal.call.disputeGameFinalityDelaySeconds(),
    reads.portal.call.respectedGameType(),
    reads.dgf.call.gameCount(),
  ]);
  const total = u256ToBigInt(count);
  const games =
    total > 1n
      ? /** @type {unknown[]} */ (
          await readLatestGames(
            reads.dgf,
            Number(gameType),
            total - 1n,
            total < OUTPUT_SAMPLE ? total : OUTPUT_SAMPLE
          )
        )
      : [];
  const times = games
    .map((game) => Number(tupleValue(game, "timestamp", 2)))
    .sort((a, b) => b - a);
  const gaps = times
    .slice(1)
    .map((time, index) => times[index] - time)
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);

  return {
    finalitySeconds: Number(u256ToBigInt(finality)),
    maturitySeconds: Number(u256ToBigInt(maturity)),
    outputSeconds: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
  };
}

/**
 * A proved withdrawal's record on the Portal for the account, and the
 * Portal's own check of a claim now, started together.
 *
 * @param {BridgeReads} reads
 * @param {`0x${string}`} hash
 * @param {number[]} account
 */
const readClaimRecord = (reads, hash, account) => {
  const id = hexToArray(hash, 32);

  return Promise.all([
    reads.portal.call.finalizedWithdrawals(id),
    reads.portal.call.provenWithdrawals([id, account]),
    settle(reads.portal.call.checkWithdrawal([id, account])),
  ]).then(([finalized, proven, check]) => ({
    claimed: Boolean(finalized),
    provenAt: BigInt(tupleValue(proven, "timestamp", 1)),
    proxy: evmAddressToHex(tupleValue(proven, "disputeGameProxy", 0)),
    ready: !check.error,
  }));
};

/**
 * The games of the proofs still waiting, each on its hub, with whether the
 * Portal blacklisted it, in one query; the hubs are read once a session. A
 * game that can't be read is null.
 *
 * @param {BridgeReads} reads
 * @param {Awaited<ReturnType<typeof readClaimRecord>>[]} records
 */
async function readProofGames(reads, records) {
  const proxies = [
    ...new Set(
      records
        .filter(
          (record) =>
            !record.claimed &&
            record.provenAt !== 0n &&
            record.proxy !== ZERO_ADDRESS
        )
        .map((record) => record.proxy)
    ),
  ];
  const hubs = await Promise.all(
    proxies.map((proxy) => hubOfGame(reads, proxy).catch(() => null))
  );
  const games = await Promise.all(
    proxies.map((proxy, at) => {
      const hubId = hubs[at];

      return hubId
        ? Promise.all([
            readGame(reads, hubId, proxy),
            reads.portal.call
              .disputeGameBlacklist(hexToArray(proxy, 20))
              .then(Boolean),
          ])
            .then(([game, blacklisted]) => ({ ...game, blacklisted }))
            .catch(() => null)
        : null;
    })
  );

  return new Map(proxies.map((proxy, at) => [proxy, games[at]]));
}

/**
 * When the withdrawals an account proved can be claimed, by their hashes,
 * as the chain says: each one's record on the Portal and the Portal's check
 * of a claim now in one query, the proofs' games in the next. A withdrawal
 * claimed already says so; one the account has no proof of, or whose game
 * can't be read, has no date, and one whose proof must be made again says
 * that instead.
 *
 * @param {`0x${string}`[]} hashes
 * @param {{ reads?: BridgeReads, submitter: `0x${string}` }} options
 * @returns {Promise<Map<string, WithdrawalClaim>>}
 */
export async function readWithdrawalClaims(
  hashes,
  { reads = contractReads(), submitter }
) {
  const account = hexToArray(submitter, 20);
  const tip = settle(networkStore.getLatestBlock());
  const [maturity, finality, ...records] = await Promise.all([
    reads.portal.call.proofMaturityDelaySeconds(),
    reads.portal.call.disputeGameFinalityDelaySeconds(),
    ...hashes.map((hash) => readClaimRecord(reads, hash, account)),
  ]);
  const games = await readProofGames(reads, records);
  const latest = (await tip).value ?? null;
  const portal = {
    disputeGameFinalityDelaySeconds: u256ToBigInt(finality),
    proofMaturityDelaySeconds: u256ToBigInt(maturity),
  };

  return new Map(
    hashes.map((hash, at) => {
      const record = records[at];
      const game = record.claimed ? null : (games.get(record.proxy) ?? null);
      // The Portal takes no claim of a proof whose game was blacklisted, or
      // that the challenger won: it must be made again.
      const reprove = Boolean(
        game &&
        (game.blacklisted || game.status === GAME_STATUS.CHALLENGER_WINS)
      );
      const claim =
        game && latest && !reprove
          ? claimFrom({
              clock: contractClock(record.provenAt, latest),
              game,
              portal,
              provenAt: record.provenAt,
              tip: latest,
            })
          : { at: null, exact: false, overdue: false };
      // Ready once the Portal takes the claim and its date has come.
      const { claimOverdue, ready } = latest
        ? claimReadiness({ claim, portalAccepts: record.ready, tip: latest })
        : { claimOverdue: claim.overdue, ready: record.ready };

      return [
        hash.toLowerCase(),
        {
          ...claim,
          claimed: record.claimed,
          overdue: claimOverdue,
          ready: !record.claimed && !reprove && ready,
          reprove,
        },
      ];
    })
  );
}

/**
 * @param {string} txHash
 */
export async function loadDuskTransactionExecution(txHash) {
  const normalizedHash = strip0x(txHash);

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
 * The gas to prove or finalize a withdrawal with, one for both steps
 * (`withdrawalGasLimit`). The Portal hands the gas it has left to the
 * withdrawal's own call, so it adds the gas the withdrawal asks for. A
 * withdrawal that needs more than the wallet's upper gas bound isn't sent:
 * less gas could leave its call short, and finalizing can consume the
 * withdrawal even when that call fails.
 *
 * @param {bigint} [own] The gas the withdrawal's own call asks for
 * @returns {Gas}
 */
export function withdrawalGas(own = 0n) {
  const { gasLimitUpper } = get(gasStore);
  const limit = withdrawalGasLimit(own);

  if (limit > gasLimitUpper) {
    throw new Error(WITHDRAWAL_GAS_REFUSAL);
  }

  return new Gas({
    limit,
    price: get(settingsStore).customGasPrice ?? get(gasPriceStore),
  });
}

export { PREPARED_PROOF_MS };

/**
 * Proofs whose claim date was shown, by withdrawal transaction, for a short
 * while: the proof sent is then the one the date was for.
 *
 * @type {Map<string, { at: number, claim: ClaimDate | null, event: any, proof: any }>}
 */
const preparedProofs = new Map();

/**
 * The proof of a withdrawal, and when it can be claimed if the proof is made
 * now: against a game that covers the withdrawal and has already resolved,
 * where there is one, so the date is exact; otherwise against the newest
 * game that covers it, and the date is the earliest.
 *
 * @param {`0x${string}`} txHash
 * @param {{ reads?: BridgeReads }} [options]
 */
export async function prepareProof(txHash, { reads = contractReads() } = {}) {
  const event = parseWithdrawalReceipt(await fetchL2Receipt(txHash));
  const tipRead = networkStore.getLatestBlock();
  const delays = Promise.all([
    reads.portal.call.proofMaturityDelaySeconds(),
    reads.portal.call.disputeGameFinalityDelaySeconds(),
  ]);

  delays.catch(() => {});

  const tip = await tipRead;
  const proof = await findWithdrawalProof({
    preferResolved: { tip },
    reads,
    withdrawalBlockNumber: event.blockNumber,
    withdrawalHash: event.withdrawalHash,
  });
  const claim = await Promise.all([
    hubOfGame(reads, proof.disputeGameProxy).then((hubId) =>
      readGame(reads, hubId, proof.disputeGameProxy)
    ),
    delays,
  ])
    .then(([game, [maturity, finality]]) =>
      claimFrom({
        game,
        portal: {
          disputeGameFinalityDelaySeconds: u256ToBigInt(finality),
          proofMaturityDelaySeconds: u256ToBigInt(maturity),
        },
        tip,
      })
    )
    .catch(() => null);
  const prepared = {
    at: Date.now(),
    claim: claim?.at ? claim : null,
    event,
    proof,
  };

  // Kept only with a date: one read again without leaves in place the proof
  // whose date is still shown.
  if (prepared.claim) {
    preparedProofs.set(txHash.toLowerCase(), prepared);
  }

  return prepared;
}

/**
 * When a withdrawal can be claimed if it's proved now; null when that can't
 * be read. The proof it's for is the one "Prove on Dusk" then sends.
 *
 * @param {`0x${string}`} txHash
 * @returns {Promise<ClaimDate | null>}
 */
export const loadProveNowClaim = (txHash) =>
  prepareProof(txHash).then(({ claim }) => claim);

/**
 * Proves a withdrawal on Dusk: with the proof whose claim date was shown
 * when there's one from the last two minutes, or else a new one.
 *
 * @param {`0x${string}`} txHash
 */
export async function proveWithdrawal(txHash) {
  const key = txHash.toLowerCase();
  const kept = preparedProofs.get(key);
  const { event, proof } =
    kept && Date.now() - kept.at < PREPARED_PROOF_MS
      ? kept
      : await prepareProof(txHash);

  preparedProofs.delete(key);

  const config = requireWithdrawalFinalizationConfig();
  const response = await walletStore.proveDuskEvmWithdrawal(
    config.optimismPortalContractId,
    config.optimismPortalDataDriverUrl,
    [
      withdrawalToDriverInput(event.withdrawal),
      bigIntToU256(proof.disputeGameIndex),
      outputRootProofToDriverInput(proof.outputRootProof),
      proof.withdrawalProof.map((/** @type {`0x${string}`} */ node) =>
        hexToArray(node, undefined)
      ),
    ],
    withdrawalGas(event.withdrawal.gasLimit)
  );

  return response.hash;
}

/**
 * @param {`0x${string}`} txHash
 * @param {{ reads?: BridgeReads }} [options]
 */
export async function finalizeWithdrawal(txHash, options = {}) {
  const status = await loadWithdrawalStatus(txHash, options);

  if (status.stage !== "ready_to_finalize") {
    throw new Error(finalizationNotReadyMessage(status));
  }

  const config = requireWithdrawalFinalizationConfig();

  const response = await walletStore.finalizeDuskEvmWithdrawal(
    config.optimismPortalContractId,
    config.optimismPortalDataDriverUrl,
    withdrawalToDriverInput(status.withdrawal),
    withdrawalGas(status.withdrawal.gasLimit)
  );

  return response.hash;
}

/**
 * @param {any} status
 */
function finalizationNotReadyMessage(status) {
  if (status.statusMessage) {
    return status.statusMessage;
  }

  switch (status.stage) {
    case "waiting_for_output":
      return "The withdrawal is waiting for an output proposal.";
    case "ready_to_prove":
      return "The withdrawal must be proven before it can be finalized.";
    case "prove_submitted":
      return "The withdrawal proof transaction is still pending.";
    case "proven_waiting":
      return "The withdrawal is proven but not ready to finalize yet.";
    case "finalize_submitted":
      return "The finalization transaction is already pending.";
    case "finalized":
      return "The withdrawal is already finalized.";
    default:
      return "The withdrawal is not ready to finalize yet.";
  }
}
