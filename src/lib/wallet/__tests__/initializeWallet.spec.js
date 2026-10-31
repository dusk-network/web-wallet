import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ProfileGenerator } from "@dusk/w3sper";

import { contactsNamespace } from "$lib/contacts/contactsVault";
import { settingsStore, walletStore } from "$lib/stores";

import { initializeWallet } from "..";

describe("initializeWallet", () => {
  const settingsResetSpy = vi
    .spyOn(settingsStore, "reset")
    .mockReturnValue(undefined);
  const clearWalletAndInitSpy = vi
    .spyOn(walletStore, "clearLocalDataAndInit")
    .mockResolvedValue(undefined);

  afterEach(() => {
    settingsResetSpy.mockClear();
    clearWalletAndInitSpy.mockClear();
  });

  afterAll(() => {
    settingsResetSpy.mockRestore();
    clearWalletAndInitSpy.mockRestore();
  });

  it("should keep only the restored wallet's contacts, and those kept in plain text only when it's the wallet this device had", async () => {
    const key = `${CONFIG.LOCAL_STORAGE_APP_KEY}-encrypted-contacts`;
    const plainKey = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`;
    const mnemonic =
      "cart dad sail wreck robot grit combine noble rap farm slide sad";
    const restored = await new ProfileGenerator(async () => new Uint8Array())
      .default;
    const own = await contactsNamespace(String(restored.account));
    const record = { data: "AA==", iv: "AAAAAAAAAAAAAAAA", v: 1 };

    localStorage.setItem(key, JSON.stringify({ other: record, [own]: record }));
    localStorage.setItem(plainKey, "{}");
    settingsStore.update((settings) => ({
      ...settings,
      userId: String(restored.address),
    }));

    // The wallet this device had, restored again.
    await initializeWallet(mnemonic, 0n);

    expect(JSON.parse(localStorage.getItem(key) ?? "")).toStrictEqual({
      [own]: record,
    });
    expect(localStorage.getItem(plainKey)).toBe("{}");

    // Another one was here: the contacts in plain text were its own.
    settingsStore.update((settings) => ({ ...settings, userId: "another" }));
    await initializeWallet(mnemonic, 0n);

    expect(localStorage.getItem(plainKey)).toBeNull();

    // None was: they belong to none.
    localStorage.setItem(plainKey, "{}");
    settingsStore.update((settings) => ({ ...settings, userId: "" }));
    await initializeWallet(mnemonic, 0n);

    expect(localStorage.getItem(plainKey)).toBeNull();
    localStorage.clear();
  });

  it("should keep the bridge's transfers only when the restored wallet is the one this device had", async () => {
    const mnemonic =
      "cart dad sail wreck robot grit combine noble rap farm slide sad";
    const restored = await new ProfileGenerator(async () => new Uint8Array())
      .default;
    const keys = [
      "dusk-evm:deposit-activity:v1",
      "dusk-evm:last-withdrawal-tx-hash",
      "dusk-evm:withdrawal-activity:v1",
    ];
    const times = `${CONFIG.LOCAL_STORAGE_APP_KEY}-bridge-times-testnet-x`;
    const keep = () => {
      for (const key of [...keys, times]) {
        localStorage.setItem(key, "[]");
      }
    };

    keep();
    settingsStore.update((settings) => ({
      ...settings,
      userId: String(restored.address),
    }));

    // The wallet this device had, restored again: its own.
    await initializeWallet(mnemonic, 0n);

    for (const key of keys) {
      expect(localStorage.getItem(key)).toBe("[]");
    }

    // Another one was here: they were its own.
    settingsStore.update((settings) => ({ ...settings, userId: "another" }));
    await initializeWallet(mnemonic, 0n);

    for (const key of keys) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    // What the chains said of the bridge's times is no wallet's.
    expect(localStorage.getItem(times)).toBe("[]");
    localStorage.clear();
  });

  it("should clear the settings store and initialize a new wallet", async () => {
    const mnemonic =
      "cart dad sail wreck robot grit combine noble rap farm slide sad";
    const from = 45n;

    await initializeWallet(mnemonic, from);

    expect(settingsResetSpy).toHaveBeenCalledTimes(1);
    expect(clearWalletAndInitSpy).toHaveBeenCalledTimes(1);
    // Without a password, the one wallet there is, under no vault ID.
    expect(clearWalletAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      from,
      { key: "", n: 1 }
    );
  });

  it("should take the place of every wallet here: the others' data gone, its own kept under the names of before", async () => {
    const { default: vault } = await import("$lib/vault");
    const { noteActiveWallet, readDirectory } =
      await import("$lib/wallets/directory");
    const mnemonic =
      "cart dad sail wreck robot grit combine noble rap farm slide sad";
    const migrations = `${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`;

    // Another wallet was here, with its own data; the password step set
    // this one up in place of it.
    await noteActiveWallet("other", { accounts: ["a"], addresses: ["s"] });
    localStorage.setItem(`${migrations}:other`, "[]");
    localStorage.setItem("dusk-evm:deposit-activity:v1:other", "[]");

    const { id } = await vault.setUp(mnemonic, "password123");

    await initializeWallet(mnemonic, 3n);

    expect(localStorage.getItem(`${migrations}:other`)).toBeNull();
    expect(
      localStorage.getItem("dusk-evm:deposit-activity:v1:other")
    ).toBeNull();
    expect(readDirectory()).toStrictEqual({
      active: id,
      legacy: id,
      wallets: {},
    });
    expect(clearWalletAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      3n,
      { key: id, n: 1 }
    );

    await vault.clear();
    localStorage.clear();
  });
});
