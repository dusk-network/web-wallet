/**
 * Fingerprint or face unlock, as far as the browser goes: WebAuthn on this
 * origin, with its PRF extension, which gives the same 32 bytes for one
 * credential and one salt, only once the authenticator has verified the person.
 * What those bytes open is the vault's ($lib/vault). A browser or authenticator
 * without PRF isn't offered it: nothing here stands in for that.
 */

import { base64ToBytes, bytesToBase64 } from "$lib/dusk/base64";
import PasskeyNoPrfError from "$lib/errors/passkey-no-prf-error";

const NO_PRF = `${CONFIG.LOCAL_STORAGE_APP_KEY}-passkey-no-prf`;

/** How long a browser that turned out to have no PRF isn't offered it again. */
const NOT_OFFERED_MS = 30 * 86_400_000;

/** How long a prompt waits. */
const TIMEOUT_MS = 60_000;

/** The flag in authenticator data that says the person was verified. */
const USER_VERIFIED = 0x04;

/** Where the flags are in authenticator data, after the RP's hash. */
const FLAGS_AT = 32;

/** @param {Uint8Array} bytes */
const toBase64Url = (bytes) =>
  bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** @param {string} text */
const fromBase64Url = (text) =>
  /** @type {Uint8Array<ArrayBuffer>} */ (
    base64ToBytes(text.replace(/-/g, "+").replace(/_/g, "/"))
  );

/** @param {number} size */
const randomBytes = (size) => crypto.getRandomValues(new Uint8Array(size));

/** An RP ID is a domain: a browser refuses a bare IP address for one. */
const hasDomain = () =>
  !/^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(location.hostname);

/**
 * Whether a device with this browser just showed it has no PRF: it isn't offered
 * again for a while.
 */
function refusedLately() {
  try {
    const at = Number(localStorage.getItem(NO_PRF));

    return at > 0 && Date.now() - at < NOT_OFFERED_MS;
  } catch {
    return false;
  }
}

function noteNoPrf() {
  try {
    localStorage.setItem(NO_PRF, String(Date.now()));
  } catch {
    // It's offered again, and says the same again.
  }
}

/**
 * Whether to offer it: a secure page on a domain, a platform authenticator that
 * verifies the person, and nothing that says it has no PRF. A browser that can't
 * tell yet is asked as it's turned on, and it isn't offered again if it has none.
 *
 * @returns {Promise<boolean>}
 */
export async function canOfferPasskey() {
  const webAuthn = globalThis.PublicKeyCredential;

  if (
    !globalThis.isSecureContext ||
    !webAuthn ||
    !navigator.credentials?.create ||
    !hasDomain() ||
    refusedLately()
  ) {
    return false;
  }

  try {
    if (!(await webAuthn.isUserVerifyingPlatformAuthenticatorAvailable())) {
      return false;
    }

    const known = await webAuthn.getClientCapabilities?.();

    return known?.["extension:prf"] !== false;
  } catch {
    return false;
  }
}

/**
 * Makes a passkey for this wallet on this device. It says what it's for, and
 * holds nothing of the wallet. Throws PasskeyNoPrfError for an authenticator
 * without PRF, and what the browser throws for one refused or cancelled.
 *
 * @returns {Promise<import("$lib/vault").Passkey>}
 */
export async function createPasskey() {
  const credential = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.create({
      publicKey: {
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          userVerification: "required",
        },
        challenge: randomBytes(32),
        extensions: /** @type {any} */ ({ prf: {} }),
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        rp: { id: location.hostname, name: "Dusk Wallet" },
        timeout: TIMEOUT_MS,
        user: {
          displayName: "Dusk Wallet",
          id: randomBytes(16),
          name: "Dusk Wallet",
        },
      },
    })
  );

  if (!credential) {
    throw new DOMException("No passkey was made", "NotAllowedError");
  }

  const passkey = {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    prfSalt: bytesToBase64(randomBytes(32)),
    transports:
      /** @type {AuthenticatorAttestationResponse} */ (
        credential.response
      ).getTransports?.() ?? [],
  };

  // `enabled` is left out where it can't say: the first ask finds out.
  if (
    /** @type {any} */ (credential.getClientExtensionResults()).prf?.enabled ===
    false
  ) {
    noteNoPrf();
    signalPasskeyGone(passkey);

    throw new PasskeyNoPrfError();
  }

  return passkey;
}

/**
 * The PRF output of a passkey: its authenticator asks the person to verify
 * themselves, and it comes only then. Throws PasskeyNoPrfError for an
 * authenticator that doesn't give it, or says it didn't verify them, and what
 * the browser throws for one refused, cancelled or not found, which it doesn't
 * tell apart.
 *
 * @param {import("$lib/vault").Passkey} passkey
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Uint8Array<ArrayBuffer>>} For its caller to wipe
 */
export async function askPasskey(
  { credentialId, prfSalt, transports },
  { signal } = {}
) {
  const credential = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.get({
      publicKey: {
        allowCredentials: [
          {
            id: fromBase64Url(credentialId),
            transports: /** @type {AuthenticatorTransport[]} */ (transports),
            type: "public-key",
          },
        ],
        challenge: randomBytes(32),
        extensions: /** @type {any} */ ({
          prf: {
            eval: {
              first: /** @type {Uint8Array<ArrayBuffer>} */ (
                base64ToBytes(prfSalt)
              ),
            },
          },
        }),
        rpId: location.hostname,
        timeout: TIMEOUT_MS,
        userVerification: "required",
      },
      ...(signal ? { signal } : {}),
    })
  );

  if (!credential) {
    throw new DOMException("No passkey was used", "NotAllowedError");
  }

  const first = /** @type {any} */ (credential.getClientExtensionResults()).prf
    ?.results?.first;
  const data = new Uint8Array(
    /** @type {AuthenticatorAssertionResponse} */ (credential.response)
      .authenticatorData
  );

  if (!first || !(data[FLAGS_AT] & USER_VERIFIED)) {
    noteNoPrf();

    throw new PasskeyNoPrfError();
  }

  return new Uint8Array(first);
}

/**
 * Tells the browser a passkey opens nothing any more, for its password manager
 * to take it off, where it can: left there, it opens nothing all the same.
 *
 * @param {Pick<import("$lib/vault").Passkey, "credentialId"> | null} passkey
 */
export function signalPasskeyGone(passkey) {
  if (!passkey) {
    return;
  }

  /** @type {any} */ (globalThis.PublicKeyCredential)
    ?.signalUnknownCredential?.({
      credentialId: passkey.credentialId,
      rpId: location.hostname,
    })
    .catch(() => {});
}
