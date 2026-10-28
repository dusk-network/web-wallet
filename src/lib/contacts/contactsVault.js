/**
 * The contacts at rest: AES-GCM-256 under a key that only the unlocked
 * wallet can make, from its seed, in a place of their own per wallet.
 * WebCrypto does all of it, as in the extension.
 *
 * The key: HKDF-SHA-256 over the seed, with CONTACTS_INFO as its info and
 * no salt (the seed is uniformly random already). It can't be exported.
 *
 * The place: a hash of the wallet's first public account, so that another
 * wallet in this browser never finds them, let alone opens them.
 *
 * A record: `{ v: 1, iv, data }`, in base64. Each write takes a fresh
 * random 12-byte IV, and the place is its additional data: a record moved
 * to another wallet's place doesn't open.
 */

import { base64ToBytes, bytesToBase64 } from "$lib/dusk/base64";

/** HKDF's info for the contacts' key; it labels their places and records too. */
export const CONTACTS_INFO = "dusk-wallet/contacts/v1";

const IV_BYTES = 12;
const RECORD_VERSION = 1;

/** @param {string} text */
const utf8 = (text) => new TextEncoder().encode(text);

/** @param {Uint8Array} bytes */
const hex = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** @param {string} namespace */
const additionalData = (namespace) => utf8(`${CONTACTS_INFO}\n${namespace}`);

/**
 * The key that encrypts a wallet's contacts, from its seed.
 *
 * @param {Uint8Array} seed
 * @returns {Promise<CryptoKey>} AES-GCM-256, not extractable
 */
export async function deriveContactsKey(seed) {
  if (!(seed instanceof Uint8Array) || seed.length < 32) {
    throw new Error("A wallet seed is required");
  }

  const material = await crypto.subtle.importKey(
    "raw",
    /** @type {Uint8Array<ArrayBuffer>} */ (seed),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: utf8(CONTACTS_INFO),
      name: "HKDF",
      salt: new Uint8Array(0),
    },
    material,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Where a wallet's contacts are kept: SHA-256 over CONTACTS_INFO and its
 * first profile's public account, in hex.
 *
 * @param {string} account
 * @returns {Promise<string>}
 */
export async function contactsNamespace(account) {
  if (!account) {
    throw new Error("A public account is required");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8(`${CONTACTS_INFO}\n${account}`)
  );

  return hex(new Uint8Array(digest));
}

/**
 * Encrypts the contacts' text for their place.
 *
 * @param {CryptoKey} key
 * @param {string} namespace
 * @param {string} text
 * @returns {Promise<ContactsRecord>}
 */
export async function sealContacts(key, namespace, text) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await crypto.subtle.encrypt(
    { additionalData: additionalData(namespace), iv, name: "AES-GCM" },
    key,
    utf8(text)
  );

  return {
    data: bytesToBase64(new Uint8Array(data)),
    iv: bytesToBase64(iv),
    v: RECORD_VERSION,
  };
}

/**
 * Decrypts a record kept at `namespace`. Throws when anything doesn't
 * match: another key, another place, or data changed since it was written.
 *
 * @param {CryptoKey} key
 * @param {string} namespace
 * @param {unknown} record
 * @returns {Promise<string>}
 */
export async function unsealContacts(key, namespace, record) {
  const { data, iv, v } = /** @type {Partial<ContactsRecord>} */ (record ?? {});

  if (
    v !== RECORD_VERSION ||
    typeof iv !== "string" ||
    typeof data !== "string"
  ) {
    throw new Error("Unknown contacts format");
  }

  const ivBytes = base64ToBytes(iv);

  if (ivBytes.length !== IV_BYTES) {
    throw new Error("Unknown contacts format");
  }

  const plain = await crypto.subtle.decrypt(
    {
      additionalData: additionalData(namespace),
      iv: /** @type {Uint8Array<ArrayBuffer>} */ (ivBytes),
      name: "AES-GCM",
    },
    key,
    /** @type {Uint8Array<ArrayBuffer>} */ (base64ToBytes(data))
  );

  return new TextDecoder().decode(plain);
}
