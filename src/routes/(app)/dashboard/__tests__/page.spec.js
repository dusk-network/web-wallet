import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";
import { renderWithSimpleContent } from "$lib/dusk/test-helpers";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { stakeInfo, transactions } from "$lib/mock-data";

import Dashboard from "../+page.svelte";
import { walletStore } from "$lib/stores";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {WalletStore} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      ...mockedWalletStore,
      getStakeInfo: () => Promise.resolve(stakeInfo),
      getTransactionsHistory: () => Promise.resolve(transactions),
    },
  };
});

vi.useFakeTimers();

describe("Dashboard", () => {
  const usdPrice = 0.5;
  const baseOptions = {
    props: { data: { currentPrice: Promise.resolve({ usd: usdPrice }) } },
  };

  afterEach(cleanup);

  afterAll(() => {
    vi.doUnmock("$lib/stores");
  });

  it("should render the dashboard page with the transactions after they are loaded", async () => {
    const { container } = renderWithSimpleContent(Dashboard, baseOptions);

    await vi.advanceTimersToNextTimerAsync();

    expect(container).toMatchSnapshot();
  });

  it("should render a card when there is an error getting transactions", async () => {
    const someError = new Error("some error message");
    const walletSpy = vi
      .spyOn(walletStore, "getTransactionsHistory")
      .mockRejectedValue(someError);
    const { container } = renderWithSimpleContent(Dashboard, baseOptions);

    await vi.advanceTimersToNextTimerAsync();

    expect(container).toMatchSnapshot();

    walletSpy.mockRestore();
  });

  it("should show the balance card, with the fiat value once the price is loaded", async () => {
    const { balance } = get(mockedWalletStore);
    const expectedFiat =
      (luxToDusk(balance.shielded.value) +
        luxToDusk(balance.unshielded.value)) *
      usdPrice;
    const { container } = renderWithSimpleContent(Dashboard, baseOptions);

    expect(container.querySelector(".dusk-balance")).toBeInTheDocument();
    expect(container.querySelector(".dusk-balance__fiat--visible")).toBeNull();

    await vi.advanceTimersToNextTimerAsync();

    expect(
      container.querySelector(".dusk-balance__fiat--visible")
    ).toHaveTextContent(createCurrencyFormatter("en", "usd", 2)(expectedFiat));
  });
});
