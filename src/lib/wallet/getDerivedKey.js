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
 * @returns {Promise<CryptoKey>}
 */
const getDerivedKey = async (
  pwd,
  salt,
  iterations = LEGACY_PBKDF2_ITERATIONS
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
    true,
    ["encrypt", "decrypt"]
  );

export default getDerivedKey;
