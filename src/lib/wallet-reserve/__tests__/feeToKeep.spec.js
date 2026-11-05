import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import { SOZU_FN } from "$lib/sozu/config";

import { feeToKeep } from "..";

const ACCOUNT = "my-account";

const stores = vi.hoisted(() => {
  /** @type {any} */
  const state = {
    activity: null,
    gasPrice: null,
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
  const { writable } = await import("svelte/store");

  stores.activity = writable({ rows: [] });

  return { activityState: stores.activity };
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

  it("keeps nothing for a wallet with nothing elsewhere: Max is all of it", () => {
    expect(keptFor({})).toStrictEqual({ lux: 0n, why: "" });
  });

  it("keeps the fee to unstake, for a stake or for rewards", () => {
    const toUnstake = { lux: 50_000_000n, why: "to unstake later" };

    expect(keptFor({ amount: { total: 1n } })).toStrictEqual(toUnstake);
    expect(keptFor({ reward: 1n })).toStrictEqual(toUnstake);
  });

  it("keeps the fee to unstake from Sozu", () => {
    expect(keptFor({ stDusk: 1n })).toMatchObject({
      why: "to unstake from Sozu later",
    });
  });

  it("keeps a withdrawal's proof and claim, or its claim once it's proved, whatever it pays this account", () => {
    expect(
      keptFor({ stages: [{ recipient: ACCOUNT, stage: "ready_to_prove" }] })
    ).toStrictEqual({
      lux: 120_000_000n,
      why: "to prove and claim your withdrawal",
    });
    expect(
      keptFor({ stages: [{ recipient: null, stage: "ready_to_finalize" }] })
    ).toStrictEqual({ lux: 60_000_000n, why: "to claim your withdrawal" });
    expect(
      keptFor({ stages: [{ recipient: ACCOUNT, stage: "finalized" }] }).lux
    ).toBe(0n);
    expect(
      keptFor({ stages: [{ recipient: "someone", stage: "ready_to_prove" }] })
        .lux
    ).toBe(0n);
  });

  it("keeps the largest of them, as what comes back pays the others", () => {
    expect(
      keptFor({
        amount: { total: 1n },
        stages: [{ recipient: ACCOUNT, stage: "ready_to_prove" }],
      })
    ).toMatchObject({ lux: 120_000_000n });
    expect(keptFor({ amount: { total: 1n }, stDusk: 1n })).toMatchObject({
      lux: 50_000_000n,
      why: "to unstake later",
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
