import {
  bytesToHex as viemBytesToHex,
  hexToBytes as viemHexToBytes,
} from "viem";

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {Uint8Array}
 */
export function normalizeBytes(value, name = "value") {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  if (
    value &&
    typeof value === "object" &&
    typeof value.valueOf === "function"
  ) {
    const bytes = value.valueOf();

    if (bytes instanceof Uint8Array) {
      return bytes;
    }
  }

  throw new TypeError(`${name} must be bytes`);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return viemBytesToHex(bytes);
}

/**
 * @param {string} hex
 * @param {number} [expectedBytes]
 * @returns {Uint8Array}
 */
export function hexToBytes(hex, expectedBytes) {
  const value = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (value.length % 2 !== 0 || /[^0-9a-f]/i.test(value)) {
    throw new TypeError("Invalid hex string");
  }

  const bytes = viemHexToBytes(`0x${value}`);

  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new RangeError(
      `Expected ${expectedBytes} bytes, got ${bytes.length}`
    );
  }

  return bytes;
}
