import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { nextWalletNumber } from "$lib/vault";

import {
  clearDirectory,
  forgetDirectoryWallet,
  normalizeWalletName,
  noteActiveWallet,
  readDirectory,
  setWalletName,
  startDirectory,
  walletDirectory,
  walletLabel,
} from "../directory";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`;

describe("The wallets' directory", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("names a wallet by its number until it's given a name, and numbers the next one past the highest", () => {
    expect(walletLabel({ n: 2 })).toBe("Wallet 2");
    expect(walletLabel({ n: 2, name: "  Savings   jar " })).toBe("Savings jar");
    expect(normalizeWalletName("x".repeat(40))).toHaveLength(32);

    // A gap a removed wallet left stays unused.
    expect(nextWalletNumber([{ n: 1 }, { n: 3 }])).toBe(4);
    expect(nextWalletNumber([])).toBe(1);
  });

  it("keeps what each wallet showed, its name, and the one open last, as every tab sees it", async () => {
    /** @type {import("../directory").WalletDirectory[]} */
    const seen = [];
    const stop = walletDirectory.subscribe((directory) => seen.push(directory));

    await startDirectory("k1");
    await noteActiveWallet("k1", {
      accounts: ["a0", "a1"],
      addresses: ["s0", "s1"],
    });
    await setWalletName("k1", "Main");
    await noteActiveWallet("k2", {
      accounts: ["b0", "b1"],
      addresses: ["t0", "t1"],
    });

    expect(readDirectory()).toStrictEqual({
      active: "k2",
      legacy: "k1",
      wallets: {
        k1: {
          accounts: ["a0", "a1"],
          addresses: ["s0", "s1"],
          name: "Main",
          walletId: "a0",
        },
        k2: {
          accounts: ["b0", "b1"],
          addresses: ["t0", "t1"],
          walletId: "b0",
        },
      },
    });
    expect(seen.at(-1)).toStrictEqual(readDirectory());

    // Noted again, it keeps its name; "" gives it its number back.
    await noteActiveWallet("k1", { accounts: ["a0", "a1"], addresses: [] });
    expect(readDirectory().wallets.k1.name).toBe("Main");
    await setWalletName("k1", " ");
    expect(readDirectory().wallets.k1).not.toHaveProperty("name");

    // Another tab's change, as the browser tells this one.
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...readDirectory(), active: "k1" })
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: KEY, storageArea: localStorage })
    );
    expect(get(walletDirectory).active).toBe("k1");
    stop();
  });

  it("forgets a removed wallet, the one with the names of before too, and every wallet on a reset", async () => {
    await startDirectory("k1");
    await noteActiveWallet("k2", { accounts: ["b0"], addresses: [] });
    await noteActiveWallet("k1", { accounts: ["a0"], addresses: [] });
    await forgetDirectoryWallet("k1");

    expect(readDirectory()).toStrictEqual({
      active: "",
      legacy: "",
      wallets: {
        k2: { accounts: ["b0"], addresses: [], walletId: "b0" },
      },
    });

    clearDirectory();

    expect(readDirectory()).toStrictEqual({
      active: "",
      legacy: "",
      wallets: {},
    });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("reads a directory it can't make sense of as none", () => {
    localStorage.setItem(KEY, "not json");

    expect(readDirectory()).toStrictEqual({
      active: "",
      legacy: "",
      wallets: {},
    });
  });
});
