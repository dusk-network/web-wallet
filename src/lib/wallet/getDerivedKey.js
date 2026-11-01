import { LEGACY_PBKDF2_ITERATIONS } from "./walletEncryption";

/**
 * @param {String} pwd
 * @returns {Promise<CryptoKey>}
 */
const getKeyMaterial = (pwd) =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pwd),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

/**
 * @param {String} pwd
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {number} [iterations]
 * @param {boolean} [extractable] False for a key that never leaves WebCrypto
 * @returns {Promise<CryptoKey>}
 */
const getDerivedKey = async (
  pwd,
  salt,
  iterations = LEGACY_PBKDF2_ITERATIONS,
  extractable = true
) =>
  crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      iterations,
      name: "PBKDF2",
      salt,
    },
    await getKeyMaterial(pwd),
    { length: 256, name: "AES-GCM" },
    extractable,
    ["encrypt", "decrypt"]
  );

export default getDerivedKey;
