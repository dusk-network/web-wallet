import { afterEach, describe, expect, it, vi } from "vitest";

import { PasskeyNoPrfError } from "$lib/errors";
import {
  fakeAuthenticator,
  removeFakeAuthenticator,
} from "$lib/test-helpers/fakeAuthenticator";

import {
  askPasskey,
  canOfferPasskey,
  createPasskey,
  signalPasskeyGone,
} from "../passkey";

describe("A passkey, as far as the browser goes", () => {
  afterEach(() => {
    removeFakeAuthenticator();
    localStorage.clear();
  });

  describe("whether it's offered", () => {
    it("is, on a secure page with a platform authenticator, whether the browser can say about PRF yet or not", async () => {
      fakeAuthenticator();
      await expect(canOfferPasskey()).resolves.toBe(true);

      fakeAuthenticator({ capabilities: null });
      await expect(canOfferPasskey()).resolves.toBe(true);
    });

    it("isn't, where the browser says it has no PRF", async () => {
      fakeAuthenticator({ capabilities: { "extension:prf": false } });

      await expect(canOfferPasskey()).resolves.toBe(false);
    });

    it("isn't, with no authenticator that verifies the person", async () => {
      fakeAuthenticator({ platform: false });

      await expect(canOfferPasskey()).resolves.toBe(false);
    });

    it("isn't, without WebAuthn, on an insecure page, or at an IP address, which a passkey can't be for", async () => {
      await expect(canOfferPasskey()).resolves.toBe(false);

      fakeAuthenticator();
      vi.stubGlobal("isSecureContext", false);
      await expect(canOfferPasskey()).resolves.toBe(false);

      vi.stubGlobal("isSecureContext", true);
      vi.stubGlobal("location", { hostname: "127.0.0.1" });
      await expect(canOfferPasskey()).resolves.toBe(false);
    });

    it("isn't, for a while, where the device just turned out to have no PRF", async () => {
      fakeAuthenticator({ hasPrf: false });

      await expect(canOfferPasskey()).resolves.toBe(true);
      await expect(createPasskey()).rejects.toBeInstanceOf(PasskeyNoPrfError);
      await expect(canOfferPasskey()).resolves.toBe(false);
    });
  });

  describe("making one", () => {
    it("asks for one on this device, for this site, that verifies the person, with PRF", async () => {
      const device = fakeAuthenticator();
      const made = await createPasskey();
      const [{ publicKey }] = /** @type {any} */ (device.create.mock.lastCall);

      expect(publicKey.rp.id).toBe(location.hostname);
      expect(publicKey.authenticatorSelection).toStrictEqual({
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      });
      expect(publicKey.extensions).toStrictEqual({ prf: {} });
      expect(made.credentialId).toMatch(/^[\w-]+$/);
      expect(atob(made.prfSalt)).toHaveLength(32);
      expect(made.transports).toStrictEqual(["internal"]);
    });

    it("refuses an authenticator without PRF, and tells the browser to take that passkey off", async () => {
      const device = fakeAuthenticator({ hasPrf: false });

      await expect(createPasskey()).rejects.toBeInstanceOf(PasskeyNoPrfError);
      expect(device.signalled).toHaveLength(1);
    });

    it("leaves what the browser says of one refused to its caller", async () => {
      const device = fakeAuthenticator();

      device.personAnswers("NotAllowedError");

      await expect(createPasskey()).rejects.toMatchObject({
        name: "NotAllowedError",
      });
    });
  });

  describe("asking one", () => {
    it("gives the same bytes for one passkey and salt, others for another of either, verifying the person, on this site", async () => {
      const device = fakeAuthenticator();
      const one = await createPasskey();
      const first = await askPasskey(one);

      expect(first).toHaveLength(32);
      expect(await askPasskey(one)).toStrictEqual(first);
      expect(
        await askPasskey({ ...one, prfSalt: btoa("x".repeat(32)) })
      ).not.toStrictEqual(first);
      expect(await askPasskey(await createPasskey())).not.toStrictEqual(first);

      const [{ publicKey }] = /** @type {any} */ (device.get.mock.lastCall);

      expect(publicKey.userVerification).toBe("required");
      expect(publicKey.rpId).toBe(location.hostname);
      expect(publicKey.allowCredentials).toHaveLength(1);
    });

    it("refuses an answer that says it didn't verify the person, or gives no PRF", async () => {
      fakeAuthenticator({ verifies: false });

      const unverified = await createPasskey();

      await expect(askPasskey(unverified)).rejects.toBeInstanceOf(
        PasskeyNoPrfError
      );

      localStorage.clear();

      const device = fakeAuthenticator();
      const made = await createPasskey();

      device.get.mockImplementationOnce(async () => {
        const data = new Uint8Array(37);

        data[32] = 0x05;

        return /** @type {any} */ ({
          getClientExtensionResults: () => ({ prf: {} }),
          rawId: new ArrayBuffer(16),
          response: { authenticatorData: data.buffer },
        });
      });

      await expect(askPasskey(made)).rejects.toBeInstanceOf(PasskeyNoPrfError);
    });

    it("leaves a passkey gone from the device, or a person who cancels, to its caller, and stops when it's told to", async () => {
      const device = fakeAuthenticator();
      const made = await createPasskey();

      device.forget();

      await expect(askPasskey(made)).rejects.toMatchObject({
        name: "NotAllowedError",
      });

      const stop = new AbortController();

      stop.abort();

      await expect(askPasskey(made, { signal: stop.signal })).rejects.toThrow();
    });
  });

  it("tells the browser a passkey opens nothing, where it can listen, and nothing breaks where it can't", () => {
    const device = fakeAuthenticator();

    signalPasskeyGone({ credentialId: "abc" });

    expect(device.signalled).toStrictEqual([
      { credentialId: "abc", rpId: location.hostname },
    ]);

    signalPasskeyGone(null);

    expect(device.signalled).toHaveLength(1);

    removeFakeAuthenticator();

    expect(() => signalPasskeyGone({ credentialId: "abc" })).not.toThrow();
  });
});
