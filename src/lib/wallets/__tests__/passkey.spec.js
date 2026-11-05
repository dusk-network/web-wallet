import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import { InvalidPasswordError, PasskeyGoneError } from "$lib/errors";
import {
  sendPasswordAsk,
  sendPasswordFor,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import {
  fakeAuthenticator,
  removeFakeAuthenticator,
} from "$lib/test-helpers/fakeAuthenticator";
import vault from "$lib/vault";

import {
  addWallet,
  changeWalletPassword,
  disablePasskey,
  enablePasskey,
  removeWallet,
  unlockWallets,
  unlockWithPasskey,
} from "..";

vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const PASSWORD = "the password";
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";
const PASSKEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login-passkey`;

describe("Fingerprint or face unlock of the wallets here", () => {
  stubWalletNetwork();

  /** @type {ReturnType<typeof fakeAuthenticator>} */
  let device;

  beforeEach(async () => {
    localStorage.clear();
    device = fakeAuthenticator();
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
  });

  afterEach(async () => {
    walletStore.reset();
    await vault.clear();
    setSendPasswordLimit(null);
    removeFakeAuthenticator();
    localStorage.clear();
  });

  it("takes the password to turn on, and then opens what it opens, the same wallet at the same accounts, with nothing typed", async () => {
    await enablePasskey(PASSWORD);

    expect(device.create).toHaveBeenCalledOnce();
    expect(device.get).toHaveBeenCalledOnce();

    const { account } = /** @type {Profile} */ (
      get(walletStore).currentProfile
    );

    walletStore.reset();

    await unlockWithPasskey();

    expect(String(get(walletStore).currentProfile?.account)).toBe(
      String(account)
    );
    expect(device.get).toHaveBeenCalledTimes(2);
  });

  it("asks the device nothing for a wrong password, and stays off", async () => {
    await expect(enablePasskey("wrong")).rejects.toBeInstanceOf(
      InvalidPasswordError
    );

    expect(device.create).not.toHaveBeenCalled();
    expect(vault.passkey()).toBeNull();
  });

  it.each([
    ["refused as it's made", "create"],
    ["refused as it's first asked", "get"],
  ])(
    "stays off when the device is %s, and takes off a passkey made for nothing",
    async (_, step) => {
      const failing = step === "create" ? device.create : device.get;

      failing.mockRejectedValueOnce(new DOMException("No", "NotAllowedError"));

      await expect(enablePasskey(PASSWORD)).rejects.toMatchObject({
        name: "NotAllowedError",
      });

      expect(localStorage.getItem(PASSKEY)).toBeNull();
      expect(device.signalled).toHaveLength(step === "get" ? 1 : 0);
    }
  );

  it("stores nothing, for a device with no PRF", async () => {
    removeFakeAuthenticator();
    device = fakeAuthenticator({ hasPrf: false });

    await expect(enablePasskey(PASSWORD)).rejects.toMatchObject({
      name: "PasskeyNoPrfError",
    });

    expect(localStorage.getItem(PASSKEY)).toBeNull();
    expect(device.signalled).toHaveLength(1);
  });

  it("still asks for the password on a big send, unlocked by fingerprint, and takes nothing else for it", async () => {
    await enablePasskey(PASSWORD);
    walletStore.reset();
    await unlockWithPasskey();
    setSendPasswordLimit(0n);

    const { walletKey } = get(walletStore);
    const going = sendPasswordFor(1n, walletKey);

    expect(going).not.toBeNull();

    const ask = get(sendPasswordAsk);

    await expect(ask?.answer("wrong")).rejects.toBeInstanceOf(
      InvalidPasswordError
    );
    await expect(ask?.answer(PASSWORD)).resolves.toBeUndefined();
    await expect(going).resolves.toBeUndefined();
    expect(device.get).toHaveBeenCalledTimes(2);
  });

  it("goes with a new password, with a removed wallet and when it's turned off, telling the browser the passkey opens nothing", async () => {
    await enablePasskey(PASSWORD);
    await changeWalletPassword(PASSWORD, "a new password");

    expect(localStorage.getItem(PASSKEY)).toBeNull();
    expect(device.signalled).toHaveLength(1);

    await expect(unlockWithPasskey()).rejects.toBeInstanceOf(PasskeyGoneError);

    const added = await addWallet(B, "a new password");

    await enablePasskey("a new password");
    await removeWallet(added.id, "a new password");

    expect(localStorage.getItem(PASSKEY)).toBeNull();
    expect(device.signalled).toHaveLength(2);

    await enablePasskey("a new password");
    await disablePasskey();

    expect(localStorage.getItem(PASSKEY)).toBeNull();
    expect(device.signalled).toHaveLength(3);
  });

  it("stops at a passkey gone from the device, and leaves the vault for the password", async () => {
    await enablePasskey(PASSWORD);
    walletStore.reset();
    device.forget();

    await expect(unlockWithPasskey()).rejects.toMatchObject({
      name: "NotAllowedError",
    });

    expect(get(walletStore).initialized).toBe(false);

    await unlockWallets(PASSWORD);

    expect(get(walletStore).initialized).toBe(true);
  });

  it("opens nothing once what asked was left", async () => {
    await enablePasskey(PASSWORD);
    walletStore.reset();

    const stop = new AbortController();

    stop.abort();

    await expect(unlockWithPasskey({ signal: stop.signal })).rejects.toThrow();

    expect(get(walletStore).initialized).toBe(false);
  });
});
