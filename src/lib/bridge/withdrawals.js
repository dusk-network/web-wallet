import {
  decodeEventLog,
  encodeAbiParameters,
  fromRlp,
  keccak256,
  parseAbiItem,
  toHex,
  toRlp,
} from "viem";

import { bytesToHex, hexToBytes } from "$lib/bridge/encoding";
import { networkStore, walletStore } from "$lib/stores";
import { duskEvm } from "$lib/web3/walletConnection";

const L2_TO_L1_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = /** @type {`0x${string}`} */ (
  "0x0000000000000000000000000000000000000000000000000000000000000000"
);

const VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID = import.meta.env
  .VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID;
const VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL = import.meta.env
  .VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL;
const VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID = import.meta.env
  .VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID;
const VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL = import.meta.env
  .VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL;
const VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH = BigInt(
  import.meta.env.VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH ?? 64
);
const DEFAULT_OPTIMISM_PORTAL_DATA_DRIVER_URL =
  "/drivers/optimism_portal_dd_opt.wasm";
const DEFAULT_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL =
  "/drivers/dispute_game_factory_dd_opt.wasm";

const messagePassedEvent = parseAbiItem(
  "event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)"
);

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
 * @param {string | undefined} value
 * @param {string} fallback
 */
function dataDriverUrl(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
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
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function getWithdrawalFinalizationConfig() {
  const missing = [];
  const optimismPortalDataDriverUrl = dataDriverUrl(
    VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL,
    DEFAULT_OPTIMISM_PORTAL_DATA_DRIVER_URL
  );
  const disputeGameFactoryDataDriverUrl = dataDriverUrl(
    VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL,
    DEFAULT_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL
  );

  if (!isContractId(VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID)) {
    missing.push("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID");
  }

  if (!isConfiguredDataDriverUrl(optimismPortalDataDriverUrl)) {
    missing.push("VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL");
  }

  if (!isContractId(VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID)) {
    missing.push("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID");
  }

  if (!isConfiguredDataDriverUrl(disputeGameFactoryDataDriverUrl)) {
    missing.push("VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL");
  }

  return Object.freeze({
    configured: missing.length === 0,
    disputeGameFactoryContractId: isContractId(
      VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID
    )
      ? normalizeContractId(VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID)
      : VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID,
    disputeGameFactoryDataDriverUrl,
    l2RpcUrl: duskEvm.rpcUrls.default.http[0],
    missing,
    optimismPortalContractId: isContractId(VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID)
      ? normalizeContractId(VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID)
      : VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID,
    optimismPortalDataDriverUrl,
  });
}

/**
 * @param {unknown} error
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

async function optimismPortalContract() {
  const config = requireWithdrawalFinalizationConfig();

  return await walletStore.useContract(
    config.optimismPortalContractId,
    config.optimismPortalDataDriverUrl
  );
}

async function disputeGameFactoryContract() {
  const config = requireWithdrawalFinalizationConfig();

  return await walletStore.useContract(
    config.disputeGameFactoryContractId,
    config.disputeGameFactoryDataDriverUrl
  );
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function bytesLikeToArray(value) {
  if (typeof value === "string") {
    return Array.from(hexToBytes(value));
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
    return value.startsWith("0x") ? BigInt(value) : BigInt(value);
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
  return {
    data: hexToArray(withdrawal.data, undefined),
    ["gas_limit"]: bigIntToU256(withdrawal.gasLimit),
    nonce: bigIntToU256(withdrawal.nonce),
    sender: hexToArray(withdrawal.sender, 20),
    target: hexToArray(withdrawal.target, 20),
    value: bigIntToU256(withdrawal.value),
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
  return {
    ["latest_blockhash"]: hexToArray(outputRootProof.latestBlockhash, 32),
    ["message_passer_storage_root"]: hexToArray(
      outputRootProof.messagePasserStorageRoot,
      32
    ),
    ["state_root"]: hexToArray(outputRootProof.stateRoot, 32),
    version: hexToArray(outputRootProof.version, 32),
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
 * @param {unknown} value
 */
function parseHexBigInt(value) {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new TypeError("Expected hex quantity");
  }

  return BigInt(value);
}

/**
 * @param {any} log
 */
export function parseMessagePassedLog(log) {
  if (!log?.address?.toLowerCase || !Array.isArray(log?.topics)) {
    throw new Error("Invalid log");
  }

  if (log.address.toLowerCase() !== L2_TO_L1_MESSAGE_PASSER.toLowerCase()) {
    throw new Error("Log is not from L2ToL1MessagePasser");
  }

  const decoded = decodeEventLog({
    abi: [messagePassedEvent],
    data: log.data,
    topics: log.topics,
  });

  const { data, gasLimit, nonce, sender, target, value, withdrawalHash } =
    decoded.args;
  const withdrawal = {
    data,
    gasLimit,
    nonce,
    sender,
    target,
    value,
  };

  return {
    withdrawal,
    withdrawalHash,
  };
}

/**
 * @param {any} receipt
 */
export function parseWithdrawalReceipt(receipt) {
  if (!receipt) {
    throw new Error("Withdrawal transaction was not found.");
  }

  if (receipt.status === "0x0") {
    throw new Error("Withdrawal transaction failed on DuskEVM.");
  }

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];

  for (const log of logs) {
    if (
      log?.address?.toLowerCase?.() !== L2_TO_L1_MESSAGE_PASSER.toLowerCase()
    ) {
      continue;
    }

    const parsed = parseMessagePassedLog(log);
    const computed = hashWithdrawal(parsed.withdrawal);

    if (computed.toLowerCase() !== parsed.withdrawalHash.toLowerCase()) {
      throw new Error("Withdrawal hash mismatch in MessagePassed event.");
    }

    return {
      ...parsed,
      blockHash: receipt.blockHash,
      blockNumber: parseHexBigInt(receipt.blockNumber),
      transactionHash: receipt.transactionHash,
    };
  }

  throw new Error("Withdrawal MessagePassed event was not found.");
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
export function hashWithdrawal(withdrawal) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      [
        withdrawal.nonce,
        withdrawal.sender,
        withdrawal.target,
        withdrawal.value,
        withdrawal.gasLimit,
        withdrawal.data,
      ]
    )
  );
}

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
 * @param {`0x${string}`} withdrawalHash
 * @param {bigint} blockNumber
 */
async function getWithdrawalProof(withdrawalHash, blockNumber) {
  const config = requireWithdrawalFinalizationConfig();
  const key = withdrawalStorageKey(withdrawalHash);
  const proof = await rpc(config.l2RpcUrl, "eth_getProof", [
    L2_TO_L1_MESSAGE_PASSER,
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
 * OP Stack clients append embedded terminal nodes when the storage proof ends
 * in a branch node. Dusk's portal proof verifier follows the same MPT shape.
 *
 * @param {`0x${string}`} key
 * @param {readonly `0x${string}`[]} proof
 */
function maybeAddProofNode(key, proof) {
  const lastProofRlp = proof[proof.length - 1];
  const lastProof = fromRlp(lastProofRlp);

  if (!Array.isArray(lastProof) || lastProof.length !== 17) {
    return proof;
  }

  const modifiedProof = [...proof];

  for (const item of lastProof) {
    if (!Array.isArray(item)) {
      continue;
    }

    const suffix = item[0]?.slice?.(3);

    if (typeof suffix !== "string" || !key.endsWith(suffix)) {
      continue;
    }

    modifiedProof.push(toRlp(item));
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
 * @param {import("@dusk/w3sper").Contract} dgf
 */
async function readGameCount(dgf) {
  return u256ToBigInt(await dgf.call.gameCount());
}

/**
 * @param {import("@dusk/w3sper").Contract} dgf
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
 * @param {import("@dusk/w3sper").Contract} dgf
 * @param {bigint} index
 */
async function readGameMetadata(dgf, index) {
  return await dgf.call.gameMetadataAtIndex(bigIntToU256(index));
}

/**
 * @param {import("@dusk/w3sper").Contract} dgf
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
 * @param {import("@dusk/w3sper").Contract} options.dgf
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
 * @param {import("@dusk/w3sper").Contract} options.dgf
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
 * @param {import("@dusk/w3sper").Contract} options.dgf
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
 * @param {import("@dusk/w3sper").Contract} portal
 */
async function readRespectedGameType(portal) {
  return Number(await portal.call.respectedGameType());
}

/**
 * @param {object} options
 * @param {bigint} options.withdrawalBlockNumber
 * @param {`0x${string}`} options.withdrawalHash
 */
async function lookupWithdrawalProof({
  withdrawalBlockNumber,
  withdrawalHash,
}) {
  const [dgf, portal] = await Promise.all([
    disputeGameFactoryContract(),
    optimismPortalContract(),
  ]);
  const gameCount = await readGameCount(dgf);
  const gameType = await readRespectedGameType(portal);

  if (gameCount === 0n) {
    return {
      lastError: new Error("No dispute games have been proposed yet."),
      proof: null,
    };
  }

  const result = await scanGamePages({
    dgf,
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
 * @param {object} options
 * @param {bigint} options.withdrawalBlockNumber
 * @param {`0x${string}`} options.withdrawalHash
 */
async function findWithdrawalProof(options) {
  const result = await lookupWithdrawalProof(options);

  if (result.proof) {
    return result.proof;
  }

  throw result.lastError;
}

/**
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {`0x${string}`} withdrawalHash
 */
async function isWithdrawalFinalized(portal, withdrawalHash) {
  return await portal.call.finalizedWithdrawals(hexToArray(withdrawalHash, 32));
}

/**
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {`0x${string}`} withdrawalHash
 */
async function readProofSubmitterCount(portal, withdrawalHash) {
  return u256ToBigInt(
    await portal.call.numProofSubmitters(hexToArray(withdrawalHash, 32))
  );
}

/**
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {`0x${string}`} withdrawalHash
 * @param {bigint} index
 */
async function readProofSubmitterAt(portal, withdrawalHash, index) {
  return evmAddressToHex(
    await portal.call.proofSubmitters([
      hexToArray(withdrawalHash, 32),
      bigIntToU256(index),
    ])
  );
}

/**
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {`0x${string}`} withdrawalHash
 * @param {`0x${string}`} proofSubmitter
 */
async function readProvenAt(portal, withdrawalHash, proofSubmitter) {
  const provenWithdrawal = await portal.call.provenWithdrawals([
    hexToArray(withdrawalHash, 32),
    hexToArray(proofSubmitter, 20),
  ]);

  return {
    disputeGameProxy: evmAddressToHex(
      tupleValue(provenWithdrawal, "disputeGameProxy", 0)
    ),
    timestamp: BigInt(tupleValue(provenWithdrawal, "timestamp", 1)),
  };
}

/**
 * @param {any} event
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {`0x${string}`} proofSubmitter
 */
async function provenWithdrawalStatus(event, portal, proofSubmitter) {
  const provenWithdrawal = await readProvenAt(
    portal,
    event.withdrawalHash,
    proofSubmitter
  );

  if (
    provenWithdrawal.timestamp === 0n ||
    provenWithdrawal.disputeGameProxy === ZERO_ADDRESS
  ) {
    const proofAvailability = await lookupWithdrawalProof({
      withdrawalBlockNumber: event.blockNumber,
      withdrawalHash: event.withdrawalHash,
    });

    if (!proofAvailability.proof) {
      return {
        ...event,
        proofSubmitter,
        provenAt: provenWithdrawal.timestamp,
        stage: "waiting_for_output",
        statusMessage: errorMessage(proofAvailability.lastError),
      };
    }

    return {
      ...event,
      disputeGameIndex: proofAvailability.proof.disputeGameIndex,
      proofL2BlockNumber: proofAvailability.proof.l2BlockNumber,
      proofSubmitter,
      provenAt: provenWithdrawal.timestamp,
      stage: "ready_to_prove",
    };
  }

  const gameStatus = await provenWithdrawalGameStatus(
    event,
    portal,
    provenWithdrawal,
    proofSubmitter
  );

  if (gameStatus.stage === "ready_to_finalize") {
    return {
      ...event,
      disputeGameProxy: provenWithdrawal.disputeGameProxy,
      proofSubmitter,
      provenAt: provenWithdrawal.timestamp,
      stage: "ready_to_finalize",
    };
  }

  return {
    ...event,
    disputeGameProxy: provenWithdrawal.disputeGameProxy,
    proofSubmitter,
    provenAt: provenWithdrawal.timestamp,
    stage: gameStatus.stage,
    statusMessage: gameStatus.statusMessage,
  };
}

/**
 * @param {any} event
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {object} provenWithdrawal
 * @param {`0x${string}`} provenWithdrawal.disputeGameProxy
 * @param {bigint} provenWithdrawal.timestamp
 * @param {`0x${string}`} proofSubmitter
 */
async function provenWithdrawalGameStatus(
  event,
  portal,
  provenWithdrawal,
  proofSubmitter
) {
  const [proofMaturityDelay, latestTimestamp] = await Promise.all([
    readProofMaturityDelaySeconds(portal),
    readLatestL1Timestamp(),
  ]);
  const readyAt = provenWithdrawal.timestamp + proofMaturityDelay;

  if (latestTimestamp < readyAt) {
    return {
      stage: "proven_waiting",
      statusMessage: `The proof maturity delay has not elapsed yet. Ready at L1 timestamp ${readyAt}.`,
    };
  }

  try {
    await checkWithdrawalAccepted(portal, event.withdrawalHash, proofSubmitter);
  } catch {
    return await classifyRejectedProofStatus(event, provenWithdrawal);
  }

  return {
    stage: "ready_to_finalize",
    statusMessage: "",
  };
}

/**
 * @param {import("@dusk/w3sper").Contract} portal
 */
async function readProofMaturityDelaySeconds(portal) {
  return u256ToBigInt(await portal.call.proofMaturityDelaySeconds());
}

async function readLatestL1Timestamp() {
  return await networkStore.getLatestBlockTimestamp();
}

/**
 * @param {import("@dusk/w3sper").Contract} portal
 * @param {`0x${string}`} withdrawalHash
 * @param {`0x${string}`} proofSubmitter
 */
async function checkWithdrawalAccepted(portal, withdrawalHash, proofSubmitter) {
  await portal.call.checkWithdrawal([
    hexToArray(withdrawalHash, 32),
    hexToArray(proofSubmitter, 20),
  ]);
}

/**
 * @param {any} event
 * @param {object} provenWithdrawal
 * @param {`0x${string}`} provenWithdrawal.disputeGameProxy
 */
async function classifyRejectedProofStatus(event, provenWithdrawal) {
  const proofAvailability = await lookupWithdrawalProof({
    withdrawalBlockNumber: event.blockNumber,
    withdrawalHash: event.withdrawalHash,
  });

  if (
    proofAvailability.proof &&
    proofAvailability.proof.disputeGameProxy.toLowerCase() !==
      provenWithdrawal.disputeGameProxy.toLowerCase()
  ) {
    return {
      stage: "ready_to_prove",
      statusMessage:
        "The existing proof is not accepted by the portal, and a newer output proposal is available. Prove the withdrawal again.",
    };
  }

  return {
    stage: "proven_waiting",
    statusMessage:
      "The existing proof is not accepted by the portal yet. Wait for the current dispute game to become accepted or for a newer output proposal.",
  };
}

/**
 * @param {any} event
 */
async function unprovenWithdrawalStatus(event) {
  const proofAvailability = await lookupWithdrawalProof({
    withdrawalBlockNumber: event.blockNumber,
    withdrawalHash: event.withdrawalHash,
  });

  if (!proofAvailability.proof) {
    return {
      ...event,
      proofSubmitterCount: 0n,
      stage: "waiting_for_output",
      statusMessage: errorMessage(proofAvailability.lastError),
    };
  }

  return {
    ...event,
    disputeGameIndex: proofAvailability.proof.disputeGameIndex,
    proofL2BlockNumber: proofAvailability.proof.l2BlockNumber,
    proofSubmitterCount: 0n,
    stage: "ready_to_prove",
  };
}

/**
 * @param {`0x${string}`} txHash
 */
export async function loadWithdrawalStatus(txHash) {
  if (!isWithdrawalTxHash(txHash)) {
    throw new Error("Enter a valid DuskEVM withdrawal transaction hash.");
  }

  const receipt = await fetchL2Receipt(txHash);
  const event = parseWithdrawalReceipt(receipt);
  const portal = await optimismPortalContract();
  const finalized = await isWithdrawalFinalized(portal, event.withdrawalHash);

  if (finalized) {
    return {
      ...event,
      stage: "finalized",
    };
  }

  const proofSubmitterCount = await readProofSubmitterCount(
    portal,
    event.withdrawalHash
  );

  if (proofSubmitterCount === 0n) {
    return await unprovenWithdrawalStatus(event);
  }

  const proofSubmitter = await readProofSubmitterAt(
    portal,
    event.withdrawalHash,
    proofSubmitterCount - 1n
  );

  return await provenWithdrawalStatus(event, portal, proofSubmitter);
}

/**
 * @param {string} fnName
 * @param {unknown} args
 */
/**
 * @param {`0x${string}`} txHash
 */
export async function proveWithdrawal(txHash) {
  const receipt = await fetchL2Receipt(txHash);
  const event = parseWithdrawalReceipt(receipt);
  const proof = await findWithdrawalProof({
    withdrawalBlockNumber: event.blockNumber,
    withdrawalHash: event.withdrawalHash,
  });

  const config = requireWithdrawalFinalizationConfig();
  const response = await walletStore.proveDuskEvmWithdrawal(
    config.optimismPortalContractId,
    config.optimismPortalDataDriverUrl,
    [
      withdrawalToDriverInput(event.withdrawal),
      bigIntToU256(proof.disputeGameIndex),
      outputRootProofToDriverInput(proof.outputRootProof),
      proof.withdrawalProof.map((node) => hexToArray(node, undefined)),
    ]
  );

  return response.hash;
}

/**
 * @param {`0x${string}`} txHash
 */
export async function finalizeWithdrawal(txHash) {
  const receipt = await fetchL2Receipt(txHash);
  const event = parseWithdrawalReceipt(receipt);
  const config = requireWithdrawalFinalizationConfig();

  const response = await walletStore.finalizeDuskEvmWithdrawal(
    config.optimismPortalContractId,
    config.optimismPortalDataDriverUrl,
    withdrawalToDriverInput(event.withdrawal)
  );

  return response.hash;
}
