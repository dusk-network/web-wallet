import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { contractDescriptors } from "$lib/contracts";

import { operationsStore, settingsStore } from "$lib/stores";

import { StakeContract } from "..";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

describe("StakeContract", () => {
  const props = {
    descriptor: contractDescriptors[2],
    stakeInfo: mockedWalletStore.getMockedStoreValue().stakeInfo,
  };

  /** @param {string} currentOperation */
  const renderOperation = (currentOperation) => {
    operationsStore.set({ currentOperation });

    return render(StakeContract, props);
  };

  /** @param {HTMLElement} container */
  const getMaxFee = (container) =>
    container.querySelector(".gas-fee__amount-value")?.textContent;

  settingsStore.update((settings) => ({
    ...settings,
    hideStakingNotice: true,
  }));

  afterEach(() => {
    cleanup();
    settingsStore.resetGasSettings();
  });

  afterAll(() => {
    operationsStore.set({ currentOperation: "" });
    settingsStore.reset();
    vi.doUnmock("$lib/stores");
  });

  it.each(["stake", "unstake", "claim-rewards"])(
    "should start %s from the staking default gas limit",
    (operation) => {
      const { container } = renderOperation(operation);

      expect(getMaxFee(container)).toBe("0.05");
    }
  );

  it("should open the gas settings for a custom gas limit below the operation's minimum", () => {
    settingsStore.update((settings) => ({
      ...settings,
      customGasLimit: 34_000_000n,
    }));

    const { getAllByRole } = renderOperation("unstake");

    expect(getAllByRole("textbox")).toHaveLength(2);
  });

  it("should keep the gas settings closed for a custom gas limit at the operation's minimum", () => {
    settingsStore.update((settings) => ({
      ...settings,
      customGasLimit: 35_000_000n,
    }));

    const { container, queryAllByRole } = renderOperation("claim-rewards");

    expect(queryAllByRole("textbox")).toHaveLength(0);
    expect(getMaxFee(container)).toBe("0.035");
  });
});
