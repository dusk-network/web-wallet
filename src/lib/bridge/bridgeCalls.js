/**
 * What a call to the DuskEVM bridge's contracts on Dusk did, read from its
 * arguments: a deposit's DuskEVM address and amount, and the amount of the
 * withdrawal a proof or a claim is for, and whom it pays. The arguments are
 * rkyv, as the bridge writes them, and must decode exactly: every pointer in
 * bounds, a withdrawal's amount the same in each place it's written, and its
 * route the bridge's own. Anything else reads as nothing.
 */

import { getAddress, keccak256, toFunctionSelector } from "viem";
import { hashWithdrawal } from "@dusk/evm-sdk";
import { duskEvmContractId } from "$lib/web3/duskEvm";

export const BRIDGE_FUNCTIONS = Object.freeze({
  claim: "finalizeWithdrawalTransaction",
  claimWithProofOf: "finalizeWithdrawalTransactionExternalProof",
  deposit: "depositETHToWithValue",
  prove: "proveWithdrawalTransaction",
});

// Archived sizes, in bytes. The root object sits at the end of the buffer.
const DEPOSIT_ROOT = 40; // u64 amount, [u8; 20] to, u32 min gas, Vec<u8> extra data
const WITHDRAWAL = 144; // nonce, value, gas limit (32 each), Vec<u8> data, sender, target (20 each)
const PROVE_ROOT = 312; // output root proof (128), game index (32), withdrawal, Vec<Vec<u8>> proof

// What the bridge relays: L1CrossDomainMessenger.relayMessage, with
// L1StandardBridge.finalizeBridgeETH as its message, from DuskEVM's
// messenger and bridge.
const RELAY_MESSAGE = "d764ad0b";
const FINALIZE_BRIDGE_ETH = "1635f5fd";
const L2_MESSENGER = "4200000000000000000000000000000000000007";
const L2_BRIDGE = "4200000000000000000000000000000000000010";

const WEI_PER_LUX = 1_000_000_000n;

// Whom a withdrawal pays on Dusk, as its `extraData` says: a Dusk account's
// key (tag 2, version 1, kind 0, then the key as 4 field elements and a
// flag), or a Dusk contract's ID (tag 32, version 1, then the ID).
const FP_BYTES = 48;
const RAW_KEY_BYTES = 4 * FP_BYTES + 1;
const FP = BigInt(
  "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"
);
const FP_R_INVERSE = BigInt(
  "0x14fec701e8fb0ce9ed5e64273c4f538b1797ab1458a88de9343ea97914956dc87fe11274d898fafbf4d38259380b4820"
);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** What a withdrawal from DuskEVM calls there: L2StandardBridge.bridgeETHTo. */
const BRIDGE_ETH_TO = toFunctionSelector(
  "bridgeETHTo(address,uint32,bytes)"
).slice(2);

/**
 * @typedef {{ amount: string, kind: "deposit", to: string }
 *   | { amount: string, hash?: `0x${string}`, kind: "claim" | "prove", recipient?: string | null, withdrawal: string }} BridgeCall
 *   Amounts in Lux; `to` is the DuskEVM address with its checksum,
 *   `withdrawal` the withdrawal's nonce, the same in its proof and its claim,
 *   `hash` the withdrawal's hash, which the Portal keys it by, and
 *   `recipient` whom it pays on Dusk (both missing from a call read before
 *   the history kept them).
 */

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/** @param {Uint8Array} bytes */
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** @returns {never} */
function fail() {
  throw new Error("Not a known bridge call");
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} length
 */
function uintLe(bytes, at, length) {
  let out = 0n;

  for (let i = length - 1; i >= 0; i--) {
    out = (out << 8n) | BigInt(bytes[at + i]);
  }

  return out;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} length
 */
function uintBe(bytes, at, length) {
  let out = 0n;

  for (let i = 0; i < length; i++) {
    out = (out << 8n) | BigInt(bytes[at + i]);
  }

  return out;
}

/**
 * An archived vector at `at`: a relative pointer and a length. Its items
 * must lie before `end` (the root), where the serializer put them.
 *
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} end
 * @param {number} [itemSize]
 */
function vecAt(bytes, at, end, itemSize = 1) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = at + view.getInt32(at, true);
  const length = view.getUint32(at + 4, true);

  if (start < 0 || start + length * itemSize > end) {
    fail();
  }

  return { length, start };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} end
 */
function bytesAt(bytes, at, end) {
  const { length, start } = vecAt(bytes, at, end);

  return bytes.subarray(start, start + length);
}

/**
 * Bytes as base58, as Dusk writes an account.
 *
 * @param {Uint8Array} bytes
 */
function base58(bytes) {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let out = "";

  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }

    out = `1${out}`;
  }

  return out;
}

/**
 * A field element of a key as the bridge carries it: Montgomery form, its
 * 48 bytes little-endian; it must be below the field's modulus.
 *
 * @param {Uint8Array} raw
 * @param {number} at
 */
function fieldAt(raw, at) {
  const montgomery = uintLe(raw, at, FP_BYTES);

  if (montgomery >= FP) {
    fail();
  }

  return (montgomery * FP_R_INVERSE) % FP;
}

/**
 * A Dusk account from its key as the bridge carries it: the key compressed
 * as Dusk writes it, x as c1 and c0 big-endian, with the compression flag
 * and whether y is the larger root on top, in base58.
 *
 * @param {Uint8Array} raw
 */
function accountOf(raw) {
  if (raw.length !== RAW_KEY_BYTES || raw[RAW_KEY_BYTES - 1] !== 0) {
    fail();
  }

  const [x0, x1, y0, y1] = [0, 1, 2, 3].map((i) => fieldAt(raw, i * FP_BYTES));
  const half = (FP - 1n) / 2n;
  const larger = y1 > half || (y1 === 0n && y0 > half);
  const compressed = new Uint8Array(2 * FP_BYTES);

  [x1, x0].forEach((part, i) => {
    for (let at = FP_BYTES - 1, rest = part; at >= 0; at--, rest >>= 8n) {
      compressed[i * FP_BYTES + at] = Number(rest & 0xffn);
    }
  });
  compressed[0] |= 0x80 | (larger ? 0x20 : 0);

  return base58(compressed);
}

/**
 * Whom a withdrawal pays on Dusk, from its `extraData`: a Dusk account, or
 * a Dusk contract's ID. Null for anything else.
 *
 * @param {Uint8Array} extraData
 * @returns {string | null}
 */
function recipientOf(extraData) {
  try {
    if (
      extraData.length === 3 + RAW_KEY_BYTES &&
      extraData[0] === 2 &&
      extraData[1] === 1 &&
      extraData[2] === 0
    ) {
      return accountOf(extraData.subarray(3));
    }

    return extraData.length >= 34 && extraData[0] === 32 && extraData[1] === 1
      ? hex(extraData.subarray(2, 34))
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} data Hex, with or without 0x
 * @returns {Uint8Array | null}
 */
function bytesOf(data) {
  const text = norm(data);

  return /^(?:[0-9a-f]{2})+$/.test(text)
    ? Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16))
    : null;
}

/**
 * Whom a withdrawal pays on Dusk, from its message as DuskEVM passed it:
 * the messenger's relay of the bridge's `finalizeBridgeETH`. Null where it
 * doesn't read as one.
 *
 * @param {unknown} data The withdrawal's data, in hex
 * @returns {string | null}
 */
export function withdrawalRecipient(data) {
  const bytes = bytesOf(data);

  try {
    const [, , , , , message] = abiCall(bytes ?? fail(), RELAY_MESSAGE, [
      "uint",
      "address",
      "address",
      "uint",
      "uint",
      "bytes",
    ]);
    const [, , , extraData] = abiCall(
      /** @type {Uint8Array} */ (message),
      FINALIZE_BRIDGE_ETH,
      ["address", "address", "uint", "bytes"]
    );

    return recipientOf(/** @type {Uint8Array} */ (extraData));
  } catch {
    return null;
  }
}

/**
 * Whom a withdrawal pays on Dusk, from the call that sent it on DuskEVM:
 * the bridge's `bridgeETHTo`. Null for any other call.
 *
 * @param {unknown} input The call's data, in hex
 * @returns {string | null}
 */
export function withdrawalCallRecipient(input) {
  const bytes = bytesOf(input);

  try {
    const [, , extraData] = abiCall(bytes ?? fail(), BRIDGE_ETH_TO, [
      "address",
      "uint",
      "bytes",
    ]);

    return recipientOf(/** @type {Uint8Array} */ (extraData));
  } catch {
    return null;
  }
}

/**
 * The EVM address DuskEVM gives a Dusk contract: the last 20 bytes of its
 * ID's keccak-256, in lower case without 0x.
 *
 * @param {string} contractId
 */
export function evmAddressOf(contractId) {
  const id = norm(contractId);

  return /^[0-9a-f]{64}$/.test(id) ? keccak256(`0x${id}`).slice(-40) : "";
}

/**
 * A call's ABI arguments by type: "uint", "address" (a word whose top 12
 * bytes are zero) or "bytes" (a word pointing at a length and the bytes).
 *
 * @param {Uint8Array} data
 * @param {string} selector
 * @param {("address" | "bytes" | "uint")[]} types
 * @returns {(bigint | Uint8Array)[]}
 */
function abiCall(data, selector, types) {
  if (
    data.length < 4 + 32 * types.length ||
    hex(data.subarray(0, 4)) !== selector
  ) {
    fail();
  }

  const body = data.subarray(4);

  return types.map((type, i) => {
    const word = body.subarray(32 * i, 32 * i + 32);

    if (type === "uint") {
      return uintBe(word, 0, 32);
    }

    if (type === "address") {
      return word.subarray(0, 12).some((b) => b !== 0)
        ? fail()
        : word.subarray(12);
    }

    const offset = uintBe(word, 0, 32);

    if (
      offset < BigInt(32 * types.length) ||
      offset + 32n > BigInt(body.length)
    ) {
      fail();
    }

    const at = Number(offset);
    const length = uintBe(body, at, 32);

    if (BigInt(at) + 32n + length > BigInt(body.length)) {
      fail();
    }

    return body.subarray(at + 32, at + 32 + Number(length));
  });
}

/** @param {Uint8Array} args */
function decodeDeposit(args) {
  const root = args.length - DEPOSIT_ROOT;

  if (root < 0 || root % 8 !== 0) {
    fail();
  }

  bytesAt(args, root + 32, root);

  return {
    amount: uintLe(args, root, 8).toString(),
    kind: /** @type {const} */ ("deposit"),
    to: getAddress(`0x${hex(args.subarray(root + 8, root + 28))}`),
  };
}

/**
 * A withdrawal as DuskEVM recorded it: what it pays, on the bridge's route
 * from messenger to messenger, relaying bridge to bridge, with its amount
 * the same in the withdrawal, the relay and the bridge's message.
 *
 * @param {Uint8Array} args
 * @param {number} at
 * @param {number} end
 * @param {string} l1Bridge
 */
function decodeWithdrawal(args, at, end, l1Bridge) {
  const value = uintBe(args, at + 32, 32);
  const data = bytesAt(args, at + 96, end);
  const sender = hex(args.subarray(at + 104, at + 124));
  const target = hex(args.subarray(at + 124, at + 144));

  if (sender !== L2_MESSENGER) {
    fail();
  }

  const [, relaySender, relayTarget, relayValue, , message] = abiCall(
    data,
    RELAY_MESSAGE,
    ["uint", "address", "address", "uint", "uint", "bytes"]
  );

  if (
    hex(/** @type {Uint8Array} */ (relaySender)) !== L2_BRIDGE ||
    hex(/** @type {Uint8Array} */ (relayTarget)) !== l1Bridge
  ) {
    fail();
  }

  const [, , amountWei] = abiCall(
    /** @type {Uint8Array} */ (message),
    FINALIZE_BRIDGE_ETH,
    ["address", "address", "uint", "bytes"]
  );

  if (value !== relayValue || relayValue !== amountWei) {
    fail();
  }

  return {
    amount: (value / WEI_PER_LUX).toString(),
    // What the Portal keys the withdrawal by: its proofs and its claim.
    hash: hashWithdrawal({
      data: `0x${hex(data)}`,
      gasLimit: uintBe(args, at + 64, 32),
      nonce: uintBe(args, at, 32),
      sender: `0x${sender}`,
      target: `0x${target}`,
      value,
    }),
    recipient: withdrawalRecipient(`0x${hex(data)}`),
    withdrawal: hex(args.subarray(at, at + 32)),
  };
}

/**
 * @param {Uint8Array} args
 * @param {string} l1Bridge
 */
function decodeProve(args, l1Bridge) {
  const root = args.length - PROVE_ROOT;

  if (root < 0 || root % 4 !== 0) {
    fail();
  }

  // The proof's nodes: each a vector before the root.
  const proof = vecAt(args, root + 304, root, 8);

  for (let i = 0; i < proof.length; i++) {
    vecAt(args, proof.start + 8 * i, root);
  }

  return {
    kind: /** @type {const} */ ("prove"),
    ...decodeWithdrawal(args, root + 160, root, l1Bridge),
  };
}

/**
 * @param {Uint8Array} args
 * @param {number} rootSize
 * @param {string} l1Bridge
 */
function decodeClaim(args, rootSize, l1Bridge) {
  const root = args.length - rootSize;

  if (root < 0 || root % 4 !== 0) {
    fail();
  }

  return {
    kind: /** @type {const} */ ("claim"),
    ...decodeWithdrawal(args, root, root, l1Bridge),
  };
}

/**
 * The bridge's contracts on Dusk, from the network's file or as set: the
 * deposit bridge and the withdrawal portal, as the history keeps contract
 * IDs.
 */
export const configuredBridge = () => ({
  bridge: norm(
    duskEvmContractId(
      "l1_standard_bridge",
      import.meta.env.VITE_BRIDGE_CONTRACT_ID
    )
  ),
  portal: norm(
    duskEvmContractId(
      "optimism_portal",
      import.meta.env.VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID
    )
  ),
});

/**
 * Whether a contract is one of the bridge's.
 *
 * @param {unknown} contractId
 * @param {{ bridge: string, portal: string }} [contracts]
 */
export function isBridgeContract(contractId, contracts = configuredBridge()) {
  const id = norm(contractId);

  return Boolean(id) && (id === contracts.bridge || id === contracts.portal);
}

/**
 * @param {Uint8Array} args
 * @param {string} fn
 * @param {string} l1Bridge
 */
function decodePortalCall(args, fn, l1Bridge) {
  switch (fn) {
    case BRIDGE_FUNCTIONS.prove:
      return decodeProve(args, l1Bridge);
    case BRIDGE_FUNCTIONS.claim:
      return decodeClaim(args, WITHDRAWAL, l1Bridge);
    case BRIDGE_FUNCTIONS.claimWithProofOf:
      return decodeClaim(args, WITHDRAWAL + 20, l1Bridge);
    default:
      return fail();
  }
}

/**
 * What a call to one of the bridge's contracts did: undefined for a call to
 * any other contract, and null for one of the bridge's calls that doesn't
 * decode exactly as the bridge writes it.
 *
 * @param {{ contractId?: string, data?: unknown, fnName?: string }} call
 *   `data` the call's arguments in hex
 * @param {{ bridge: string, portal: string }} [contracts]
 * @returns {BridgeCall | null | undefined}
 */
export function decodeBridgeCall(
  { contractId, data, fnName },
  contracts = configuredBridge()
) {
  if (!isBridgeContract(contractId, contracts)) {
    return undefined;
  }

  const id = norm(contractId);

  const text = norm(data);

  if (!/^(?:[0-9a-f]{2})+$/.test(text)) {
    return null;
  }

  const args = Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));

  try {
    return id === contracts.bridge
      ? fnName === BRIDGE_FUNCTIONS.deposit
        ? decodeDeposit(args)
        : null
      : decodePortalCall(args, String(fnName), evmAddressOf(contracts.bridge));
  } catch {
    return null;
  }
}
