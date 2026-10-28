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

  it("should clear the settings store and initialize a new wallet", async () => {
    const mnemonic =
      "cart dad sail wreck robot grit combine noble rap farm slide sad";
    const from = 45n;

    await initializeWallet(mnemonic, from);

    expect(settingsResetSpy).toHaveBeenCalledTimes(1);
    expect(clearWalletAndInitSpy).toHaveBeenCalledTimes(1);
    expect(clearWalletAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      from
    );
  });
});
