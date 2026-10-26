import { afterEach, describe, expect, it } from "vitest";

import {
  forgetVerifiedNames,
  getVerifiedName,
  keepVerifiedName,
} from "../verifiedNames";

describe("verifiedNames", () => {
  const storageKey = `${CONFIG.LOCAL_STORAGE_APP_KEY}-verified-names`;

  afterEach(() => {
    localStorage.clear();
  });

  it("should keep a verified name per network and account, in the browser's storage", () => {
    keepVerifiedName("testnet", "account-1", "alice.dusk");
    keepVerifiedName("mainnet", "account-1", "bob.dusk");

    expect(getVerifiedName("testnet", "account-1")).toBe("alice.dusk");
    expect(getVerifiedName("mainnet", "account-1")).toBe("bob.dusk");
    expect(getVerifiedName("testnet", "account-2")).toBe("");
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "")).toStrictEqual({
      "mainnet account-1": "bob.dusk",
      "testnet account-1": "alice.dusk",
    });
  });

  it("should forget the name of an account that has none any more", () => {
    keepVerifiedName("testnet", "account-1", "alice.dusk");
    keepVerifiedName("testnet", "account-1", "");

    expect(getVerifiedName("testnet", "account-1")).toBe("");
  });

  it("should forget every name", () => {
    keepVerifiedName("testnet", "account-1", "alice.dusk");
    forgetVerifiedNames();

    expect(getVerifiedName("testnet", "account-1")).toBe("");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it.each(["not json", "null", '"alice.dusk"', '{"testnet account-1": 1}'])(
    "should find no name in storage that holds %s",
    (stored) => {
      localStorage.setItem(storageKey, stored);

      expect(getVerifiedName("testnet", "account-1")).toBe("");
    }
  );
});
