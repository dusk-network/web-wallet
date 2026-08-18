import { afterEach, describe, expect, it } from "vitest";
import { bytesToBase64 } from "$lib/dusk/base64";

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

  it("should expose a method to remove the login info from the local storage", () => {
    localStorage.setItem(storeKey, storedInfo);
    loginInfoStorage.remove();

    expect(localStorage.getItem(storeKey)).toBeNull();
  });

  it("should expose a method to set the login info and convert its values to base64 before serialization", () => {
    loginInfoStorage.set(loginInfo);

    const stored = localStorage.getItem(storeKey);

    expect(stored).toBe(storedInfo);
  });

  it("should preserve the numeric encryption version", () => {
    const versionedLoginInfo = { ...loginInfo, version: 1 };

    loginInfoStorage.set(versionedLoginInfo);

    expect(byteValuesToArray(loginInfoStorage.get())).toStrictEqual(
      byteValuesToArray(versionedLoginInfo)
    );
    expect(localStorage.getItem(storeKey)).toBe(
      JSON.stringify(valuesToBase64(versionedLoginInfo))
    );
  });
});
