import { hexToBytes, normalizeBytes } from "./encoding";

export const BRIDGE_DEPOSIT_MIN_GAS_LIMIT = 150_000;

const UINT32_MAX = 2n ** 32n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

/**
 * @param {bigint} value
 * @param {bigint} max
 * @param {string} name
 */
function assertUnsignedInteger(value, max, name) {
  if (value < 0n || value > max) {
    throw new RangeError(
      `${name} must fit in ${max === UINT32_MAX ? "u32" : "u64"}`
    );
  }
}

/**
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {bigint} value
 * @param {number} bytes
 */
function writeUintLe(out, offset, value, bytes) {
  let remaining = value;

  for (let i = 0; i < bytes; i++) {
    out[offset + i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

/**
 * @param {string} address
 * @returns {Uint8Array}
 */
export function evmAddressToBytes(address) {
  return hexToBytes(address, 20);
}

/**
 * @param {Uint8Array} out
 * @param {number} rootOffset
 * @param {object} root
 * @param {bigint} root.amount
 * @param {number} root.extraLength
 * @param {bigint} root.gas
 * @param {Uint8Array} root.toBytes
 */
function writeDepositArchiveRoot(out, rootOffset, root) {
  const { amount, extraLength, gas, toBytes } = root;

  out.set(toBytes, rootOffset + 8);
  writeUintLe(out, rootOffset, amount, 8);
  writeUintLe(out, rootOffset + 28, gas, 4);

  const pointer = -(rootOffset + 32);

  writeUintLe(out, rootOffset + 32, BigInt.asUintN(32, BigInt(pointer)), 4);
  writeUintLe(out, rootOffset + 36, BigInt(extraLength), 4);
}

/**
 * Encodes the current L1 bridge `depositETHToWithValue(address,u64,u32,bytes)`
 * input tuple exactly as `rkyv::to_bytes::<_, 256>(&args)` does in the Rust
 * data-driver.
 *
 * @param {object} options
 * @param {`0x${string}`} options.to
 * @param {bigint | number} options.amountLux
 * @param {number} options.minGasLimit
 * @param {Uint8Array | ArrayBuffer | number[]} [options.extraData]
 * @returns {Uint8Array}
 */
export function encodeDepositETHToWithValueArgs({
  to,
  amountLux,
  minGasLimit,
  extraData = new Uint8Array(),
}) {
  const amount = BigInt(amountLux);
  const extra = normalizeBytes(extraData, "extraData");
  const gas = BigInt(minGasLimit);
  const paddedExtraLength = Math.ceil(extra.length / 8) * 8;
  const rootOffset = paddedExtraLength;
  const out = new Uint8Array(rootOffset + 40);

  assertUnsignedInteger(amount, UINT64_MAX, "amountLux");
  assertUnsignedInteger(gas, UINT32_MAX, "minGasLimit");

  out.set(extra, 0);
  writeDepositArchiveRoot(out, rootOffset, {
    amount,
    extraLength: extra.length,
    gas,
    toBytes: evmAddressToBytes(to),
  });
  return out;
}

/**
 * @param {object} options
 * @param {string} options.contractId
 * @param {`0x${string}`} options.to
 * @param {bigint | number} options.amountLux
 * @param {number} options.minGasLimit
 * @param {Uint8Array | ArrayBuffer | number[]} [options.extraData]
 */
export function buildDepositETHToWithValuePayload({
  contractId,
  to,
  amountLux,
  minGasLimit,
  extraData = new Uint8Array(),
}) {
  return Object.freeze({
    contractId: Array.from(hexToBytes(contractId, 32)),
    fnArgs: encodeDepositETHToWithValueArgs({
      amountLux,
      extraData,
      minGasLimit,
      to,
    }),
    fnName: "depositETHToWithValue",
  });
}
