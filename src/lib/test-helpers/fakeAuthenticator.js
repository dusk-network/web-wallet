import { createHmac } from "node:crypto";

import { vi } from "vitest";

import { bytesToBase64 } from "$lib/dusk/base64";

/** @param {Uint8Array} bytes */
const toBase64Url = (bytes) =>
  bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * A device with a platform authenticator, in place of a browser's WebAuthn, as
 * far as the wallet can tell: PRF comes from a secret of each credential, as an
 * authenticator's does, so the same credential and salt give the same bytes.
 *
 * @param {{ capabilities?: Record<string, boolean> | null, hasPrf?: boolean, platform?: boolean, verifies?: boolean }} [options]
 *   `capabilities`: what `getClientCapabilities` says, null for a browser
 *   without it; `verifies`: whether it says it verified the person
 */
export function fakeAuthenticator({
  capabilities = { "extension:prf": true },
  hasPrf = true,
  platform = true,
  verifies = true,
} = {}) {
  /** @type {Map<string, Uint8Array>} */
  const credentials = new Map();

  /** Whether the person answers its prompts, or what they do instead. */
  let answer = /** @type {Error | null} */ (null);

  const signalled = /** @type {any[]} */ ([]);

  /** @param {string} id @param {Uint8Array} salt */
  const prfOf = (id, salt) =>
    new Uint8Array(
      createHmac("sha256", /** @type {Uint8Array} */ (credentials.get(id)))
        .update(salt)
        .digest()
    );

  const authenticatorData = () => {
    const data = new Uint8Array(37);

    data[32] = verifies ? 0x05 : 0x01;

    return data.buffer;
  };

  const create = vi.fn(async (/** @type {any} */ { publicKey }) => {
    if (answer) {
      throw answer;
    }

    const rawId = crypto.getRandomValues(new Uint8Array(16));

    credentials.set(
      toBase64Url(rawId),
      crypto.getRandomValues(new Uint8Array(32))
    );

    return {
      getClientExtensionResults: () => ({
        prf: { enabled: hasPrf && Boolean(publicKey.extensions?.prf) },
      }),
      rawId: rawId.buffer,
      response: { getTransports: () => ["internal"] },
    };
  });

  const get = vi.fn(async (/** @type {any} */ { publicKey, signal }) => {
    signal?.throwIfAborted();

    if (answer) {
      throw answer;
    }

    const id = toBase64Url(new Uint8Array(publicKey.allowCredentials[0].id));

    if (!credentials.has(id)) {
      throw new DOMException("Not found", "NotAllowedError");
    }

    const salt = publicKey.extensions?.prf?.eval?.first;

    return {
      getClientExtensionResults: () => ({
        prf:
          hasPrf && salt
            ? { results: { first: prfOf(id, new Uint8Array(salt)).buffer } }
            : {},
      }),
      rawId: new Uint8Array(publicKey.allowCredentials[0].id).buffer,
      response: { authenticatorData: authenticatorData() },
    };
  });

  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", {
    ...(capabilities
      ? { getClientCapabilities: async () => capabilities }
      : {}),
    isUserVerifyingPlatformAuthenticatorAvailable: async () => platform,
    signalUnknownCredential: async (/** @type {any} */ gone) => {
      signalled.push(gone);
    },
  });
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { create, get },
  });

  return {
    create,

    /** Takes every passkey off the device, as its owner can. */
    forget: () => credentials.clear(),

    get,

    /**
     * Makes a passkey, and gives what the vault keeps of it with its PRF output.
     *
     * @returns {import("$lib/vault").Passkey & { prf: Uint8Array<ArrayBuffer> }}
     */
    passkey() {
      const rawId = crypto.getRandomValues(new Uint8Array(16));
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const credentialId = toBase64Url(rawId);

      credentials.set(credentialId, crypto.getRandomValues(new Uint8Array(32)));

      return {
        credentialId,
        prf: /** @type {Uint8Array<ArrayBuffer>} */ (prfOf(credentialId, salt)),
        prfSalt: bytesToBase64(salt),
        transports: ["internal"],
      };
    },

    /**
     * What the person does at its prompts: an error's name, for what the browser
     * says then, or null to answer them.
     *
     * @param {string | null} name
     */
    personAnswers(name) {
      answer = name ? new DOMException("No", name) : null;
    },

    /** What the browser was told to take off. */
    signalled,
  };
}

/** The browser as it was. */
export function removeFakeAuthenticator() {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "credentials");
}
