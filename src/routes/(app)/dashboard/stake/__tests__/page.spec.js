import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { settingsStore, walletStore } from "$lib/stores";
import Staking from "../+page.svelte";

vi.useFakeTimers();

describe("Staking", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("should render the staking page", async () => {
    const { container } = render(Staking);

    await vi.advanceTimersToNextTimerAsync(); // Wait until the stakeInfo promise has resolved

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should hide the spendable balance, the stakes and the rewards while balances are hidden", async () => {
    const walletSpy = vi
      .spyOn(walletStore, "subscribe")
      .mockImplementation(mockedWalletStore.subscribe);

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(Staking);
    const getTexts = (/** @type {string} */ selector) =>
      Array.from(container.querySelectorAll(selector), (element) =>
        element.textContent?.trim()
      );

    await vi.advanceTimersToNextTimerAsync();

    expect(getTexts(".contract-statuses__label")).toStrictEqual([
      "Spendable",
      "Active Stake",
      "Penalized Stake",
      "Rewards",
    ]);
    expect(getTexts(".contract-statuses__value")).toStrictEqual(
      Array(4).fill("•••• hidden")
    );

    walletSpy.mockRestore();
  });
});
