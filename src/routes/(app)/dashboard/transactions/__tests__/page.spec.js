import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { transactions } from "$lib/mock-data";
import { walletStore } from "$lib/stores";
import Transactions from "../+page.svelte";

vi.useFakeTimers();

describe("Dashboard", () => {
  afterEach(cleanup);

  // const currentPrice = Promise.resolve({ usd: 0.5 });

  it("should render the transactions page", async () => {
    vi.spyOn(walletStore, "getTransactionsHistory").mockResolvedValue(
      transactions
    );

    const { container } = render(Transactions);

    await vi.advanceTimersToNextTimerAsync();

    expect(container.firstElementChild).toMatchSnapshot();
  });
});
