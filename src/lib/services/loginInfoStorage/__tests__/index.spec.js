import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "$lib/dusk/base64";
import { refreshLocalStoragePasswordInfo } from "$lib/wallet";

import loginInfoStorage from "..";

describe("loginInfoStorage", () => {
  const storeKey = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
  /** @param {WalletEncryptInfo | null} info */
  const byteValuesToArray = (info) =>
    info === null
      ? null
      : {
          ...info,
          data: [...info.data],
          iv: [...info.iv],
          salt: [...info.salt],
        };
  /** @param {WalletEncryptInfo} info */
  const valuesToBase64 = (info) => ({
    ...info,
    data: bytesToBase64(info.data),
    iv: bytesToBase64(info.iv),
    salt: bytesToBase64(info.salt),
  });
  const loginInfo = {
    data: new TextEncoder().encode("some string"),
    iv: Uint8Array.of(1, 2, 3, 4),
    salt: Uint8Array.of(5, 6, 7, 8),
  };
  const storedInfo = JSON.stringify(valuesToBase64(loginInfo));

  afterEach(() => {
    localStorage.clear();
  });

  it("should expose a method to retrieve the login info from local storage and convert back its values to Uint8Array", () => {
    localStorage.setItem(storeKey, storedInfo);

    const result = loginInfoStorage.get();

    expect(result).toMatchObject({
      data: expect.any(Uint8Array),
      iv: expect.any(Uint8Array),
      salt: expect.any(Uint8Array),
    });

    // The `toStrictEqual` matcher doesn't play well with typed arrays in this case
    expect(byteValuesToArray(result)).toStrictEqual(
      byteValuesToArray(loginInfo)
    );
  });

  it("should return `null` if there is no login info stored", () => {
    expect(loginInfoStorage.get()).toBeNull();
  });

  it("should expose a method to remove the login info from the local storage", async () => {
    localStorage.setItem(storeKey, storedInfo);
    await loginInfoStorage.remove();

    expect(localStorage.getItem(storeKey)).toBeNull();
  });

  it("should expose a method to set the login info and convert its values to base64 before serialization", async () => {
    await loginInfoStorage.set(loginInfo);

    const stored = localStorage.getItem(storeKey);

    expect(stored).toBe(storedInfo);
  });

  it.each(["remove", "set"])(
    "should coordinate %s with conditional migration writes",
    async (method) => {
      await loginInfoStorage.set(loginInfo);
      const acquired = Promise.withResolvers();
      const release = Promise.withResolvers();
      const held = navigator.locks.request(storeKey, () => {
        acquired.resolve(undefined);
        return release.promise;
      });
      await acquired.promise;
      const replacement = { ...loginInfo, version: 1 };
      const changed =
        method === "remove"
          ? loginInfoStorage.remove()
          : loginInfoStorage.set(replacement);
      const migration = loginInfoStorage.replace(loginInfo, replacement);

      try {
        await vi.waitFor(async () => {
          expect((await navigator.locks.query()).pending).toHaveLength(2);
        });
        expect(localStorage.getItem(storeKey)).toBe(storedInfo);
      } finally {
        release.resolve(undefined);
        await Promise.all([held, changed]);
      }
      await expect(migration).resolves.toBe(false);
      expect(localStorage.getItem(storeKey)).toBe(
        method === "remove" ? null : JSON.stringify(valuesToBase64(replacement))
      );
    }
  );

  it("should let a reset win over pending password setup", async () => {
    await loginInfoStorage.set(loginInfo);
    const encrypted = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const encryptSpy = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementationOnce(async (...args) => {
        const result = await encrypt(...args);
        encrypted.resolve(undefined);
        await resume.promise;
        return result;
      });
    const setup = refreshLocalStoragePasswordInfo(
      ["test mnemonic"],
      "password"
    );
    await encrypted.promise;
    const reset = loginInfoStorage.remove();
    try {
      await vi.waitFor(async () => {
        expect((await navigator.locks.query()).pending).toHaveLength(1);
      });
      expect(localStorage.getItem(storeKey)).toBe(storedInfo);
    } finally {
      resume.resolve(undefined);
      await Promise.all([setup, reset]);
      encryptSpy.mockRestore();
    }
    expect(loginInfoStorage.get()).toBeNull();
  });

  it("should preserve the old login record when password setup fails", async () => {
    await loginInfoStorage.set(loginInfo);
    const error = new Error("Encryption failed");
    const encryptSpy = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockRejectedValueOnce(error);
    try {
      await expect(
        refreshLocalStoragePasswordInfo(["test mnemonic"], "password")
      ).rejects.toBe(error);
      expect(localStorage.getItem(storeKey)).toBe(storedInfo);
    } finally {
      encryptSpy.mockRestore();
    }
  });

  it("should preserve the numeric encryption version", async () => {
    const versionedLoginInfo = { ...loginInfo, version: 1 };

    await loginInfoStorage.set(versionedLoginInfo);

    expect(byteValuesToArray(loginInfoStorage.get())).toStrictEqual(
      byteValuesToArray(versionedLoginInfo)
    );
    expect(localStorage.getItem(storeKey)).toBe(
      JSON.stringify(valuesToBase64(versionedLoginInfo))
    );
  });
});
