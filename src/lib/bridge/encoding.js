import { bls12_381 as bls12381 } from "@noble/curves/bls12-381";

export const BRIDGE_RECIPIENT_EXTERNAL = 0x00;
export const DUSK_COMPRESSED_BLS_PUBLIC_KEY_BYTES = 96;
export const DUSK_RAW_BLS_PUBLIC_KEY_BYTES = 193;
export const BRIDGE_EXTERNAL_RECIPIENT_BYTES =
  1 + DUSK_RAW_BLS_PUBLIC_KEY_BYTES;

const BLS12_381_FP_MODULUS = BigInt(
  "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"
);
const BLS12_381_MONTGOMERY_R = (1n << 384n) % BLS12_381_FP_MODULUS;
const UINT64_MASK = (1n << 64n) - 1n;

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
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
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

  const bytes = Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
  );

  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new RangeError(
      `Expected ${expectedBytes} bytes, got ${bytes.length}`
    );
  }

  return bytes;
}

/**
 * Dusk bridge recipient bytes use `PublicKey::to_raw_bytes()`, which stores each
 * Fp coordinate in Montgomery form as six little-endian u64 limbs.
 *
 * @param {bigint} value canonical BLS12-381 Fp value
 * @returns {Uint8Array}
 */
function encodeFpMontgomeryRaw(value) {
  let montgomery = (value * BLS12_381_MONTGOMERY_R) % BLS12_381_FP_MODULUS;
  const out = new Uint8Array(48);

  for (let limbIndex = 0; limbIndex < 6; limbIndex++) {
    let limb = montgomery & UINT64_MASK;

    for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
      out[limbIndex * 8 + byteIndex] = Number(limb & 0xffn);
      limb >>= 8n;
    }

    montgomery >>= 64n;
  }

  return out;
}

/**
 * @param {unknown} accountPublicKey compressed Dusk account public key bytes
 * @returns {Uint8Array}
 */
export function compressedBlsPublicKeyToRaw(accountPublicKey) {
  const compressed = normalizeBytes(accountPublicKey, "account public key");

  if (compressed.length !== DUSK_COMPRESSED_BLS_PUBLIC_KEY_BYTES) {
    throw new RangeError(
      `Expected ${DUSK_COMPRESSED_BLS_PUBLIC_KEY_BYTES} compressed BLS bytes, got ${compressed.length}`
    );
  }

  const point = bls12381.G2.ProjectivePoint.fromHex(compressed);

  point.assertValidity();

  const { x, y } = point.toAffine();
  const raw = new Uint8Array(DUSK_RAW_BLS_PUBLIC_KEY_BYTES);
  let offset = 0;

  for (const part of [x.c0, x.c1, y.c0, y.c1]) {
    raw.set(encodeFpMontgomeryRaw(part), offset);
    offset += 48;
  }

  raw[DUSK_RAW_BLS_PUBLIC_KEY_BYTES - 1] = point.equals(
    bls12381.G2.ProjectivePoint.ZERO
  )
    ? 1
    : 0;

  return raw;
}

/**
 * @param {unknown} accountPublicKey compressed Dusk account public key bytes
 * @returns {Uint8Array}
 */
export function encodeExternalBridgeRecipient(accountPublicKey) {
  const recipient = new Uint8Array(BRIDGE_EXTERNAL_RECIPIENT_BYTES);

  recipient[0] = BRIDGE_RECIPIENT_EXTERNAL;
  recipient.set(compressedBlsPublicKeyToRaw(accountPublicKey), 1);

  return recipient;
}

/**
 * @param {unknown} accountPublicKey compressed Dusk account public key bytes
 * @returns {`0x${string}`}
 */
export function encodeExternalBridgeRecipientHex(accountPublicKey) {
  return /** @type {`0x${string}`} */ (
    bytesToHex(encodeExternalBridgeRecipient(accountPublicKey))
  );
}
