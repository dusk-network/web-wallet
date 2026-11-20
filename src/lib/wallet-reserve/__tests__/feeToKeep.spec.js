import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import { SOZU_FN } from "$lib/sozu/config";

import { feeToKeep } from "..";

const ACCOUNT = "my-account";

/**
 * What it's kept for, by its key word.
 *
 * @param {RegExp} words
 */
const said = (words) => expect.stringMatching(words);

const stores = vi.hoisted(() => {
  /** @type {any} */
  const state = {
    activity: null,
    gasPrice: null,
    older: null,
    settings: null,
    sozu: null,
    wallet: null,
    withdrawals: null,
  };

  return state;
});

vi.mock("$lib/stores", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  stores.wallet = writable({});
  stores.settings = writable({ customGasLimit: null, customGasPrice: null });
  stores.gasPrice = writable(1n);

  return {
    .../** @type {object} */ (await importOriginal()),
    gasPriceStore: stores.gasPrice,
    settingsStore: stores.settings,
    walletStore: stores.wallet,
  };
});

vi.mock("$lib/sozu", async () => {
  const { writable } = await import("svelte/store");
  const { isSozuFunction } = await import("$lib/sozu/config");

  stores.sozu = Object.assign(writable({ account: "", status: null }), {
    load: vi.fn(),
  });

  return { isSozuFunction, sozuStore: stores.sozu };
});

vi.mock("$lib/activity", async () => {
  const { derived, writable } = await import("svelte/store");

  const activity = writable({ rows: /** @type {any[]} */ ([]) });
  const older = writable(/** @type {any[]} */ ([]));

  stores.activity = activity;
  stores.older = older;

  return {
    activityState: activity,
    // All of the history: the page shown, then what's further back.
    wholeActivity: derived([activity, older], ([{ rows }, before]) => ({
      failed: false,
      reading: false,
      rows: [...rows, ...before],
      whole: true,
    })),
  };
});

vi.mock("$lib/bridge/withdrawalActivityStorage", async () => {
  const { writable } = await import("svelte/store");

  stores.withdrawals = writable([]);

  return { withdrawalActivityStore: stores.withdrawals };
});

/**
 * What Max keeps for a wallet holding these.
 *
 * @param {{ amount?: any, reward?: bigint, stDusk?: bigint, stages?: any[] }} held
 */
function keptFor({ amount = null, reward = 0n, stDusk = 0n, stages = [] }) {
  stores.wallet.set({
    currentProfile: { account: ACCOUNT },
    stakeInfo: { amount, reward },
  });
  stores.sozu.set({
    account: ACCOUNT,
    status: { position: { balance: stDusk, stDusk } },
  });
  stores.withdrawals.set(stages);

  return get(feeToKeep);
}

describe("feeToKeep", () => {
  it("reads Sozu for an account that called a pool of its, on whichever page comes first, and not for others", () => {
    stores.activity.set({ rows: [{ fnName: "transfer" }] });
    get(feeToKeep);
    expect(stores.sozu.load).not.toHaveBeenCalled();

    stores.activity.set({ rows: [{ fnName: SOZU_FN.STAKE }] });
    get(feeToKeep);
    expect(stores.sozu.load).toHaveBeenCalledOnce();
  });

  it("reads Sozu for an account that called a pool of its further back than the page History has shown", () => {
    stores.sozu.load.mockClear();
    stores.activity.set({ rows: [{ fnName: "transfer" }] });
    stores.older.set([{ fnName: SOZU_FN.STAKE }]);

    try {
      get(feeToKeep);
      expect(stores.sozu.load).toHaveBeenCalledOnce();
    } finally {
      stores.older.set([]);
    }
  });

  it("keeps nothing for a wallet with nothing elsewhere: Max is all of it", () => {
    expect(keptFor({})).toStrictEqual({ lux: 0n, why: "" });
  });

  it("keeps the fee to unstake, for a stake or for rewards", () => {
    const toUnstake = { lux: 50_000_000n, why: said(/unstake/) };

    expect(keptFor({ amount: { total: 1n } })).toStrictEqual(toUnstake);
    expect(keptFor({ reward: 1n })).toStrictEqual(toUnstake);
  });

  it("keeps the fee to unstake from Sozu", () => {
    // Sozu's unstake gas, 10,000,000, at the lowest price.
    expect(keptFor({ stDusk: 1n })).toStrictEqual({
      lux: 10_000_000n,
      why: said(/Sozu/),
    });
  });

  it("keeps a withdrawal's proof and claim, or its claim once it's proved, whatever it pays this account", () => {
    expect(
      keptFor({ stages: [{ recipient: ACCOUNT, stage: "ready_to_prove" }] }),
    ).toStrictEqual({ lux: 120_000_000n, why: said(/prove/) });
    expect(
      keptFor({ stages: [{ recipient: null, stage: "ready_to_finalize" }] }),
    ).toStrictEqual({ lux: 60_000_000n, why: said(/claim/) });
    expect(
      keptFor({ stages: [{ recipient: ACCOUNT, stage: "finalized" }] }).lux,
    ).toBe(0n);
    expect(
      keptFor({ stages: [{ recipient: "someone", stage: "ready_to_prove" }] })
        .lux,
    ).toBe(0n);
  });

  it("keeps the largest of them, as what comes back pays the others", () => {
    expect(
      keptFor({
        amount: { total: 1n },
        stages: [{ recipient: ACCOUNT, stage: "ready_to_prove" }],
      }),
    ).toMatchObject({ lux: 120_000_000n });
    // The stake's 50,000,000, not Sozu's 10,000,000.
    expect(keptFor({ amount: { total: 1n }, stDusk: 1n })).toMatchObject({
      lux: 50_000_000n,
    });
  });

  it("follows the fee the wallet would pay", () => {
    stores.gasPrice.set(2n);

    expect(keptFor({ amount: { total: 1n } }).lux).toBe(100_000_000n);

    stores.gasPrice.set(1n);
    stores.settings.set({ customGasLimit: 40_000_000n, customGasPrice: 3n });

    expect(keptFor({ amount: { total: 1n } }).lux).toBe(120_000_000n);

    stores.settings.set({ customGasLimit: null, customGasPrice: null });
  });

  it("goes by Sozu's account as read: another profile's position isn't this one's", () => {
    stores.wallet.set({
      currentProfile: { account: ACCOUNT },
      stakeInfo: { amount: null, reward: 0n },
    });
    stores.sozu.set({
      account: "another-account",
      status: { position: { balance: 1n, stDusk: 1n } },
    });
    stores.withdrawals.set([]);

    expect(get(feeToKeep).lux).toBe(0n);
  });
});
