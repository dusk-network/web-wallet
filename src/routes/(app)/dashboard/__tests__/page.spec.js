import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { renderWithSimpleContent } from "$lib/dusk/test-helpers";
import mockedShieldedStatusStore from "$lib/mocks/mockedShieldedStatusStore";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { stakeInfo, transactions } from "$lib/mock-data";

import Dashboard from "../+page.svelte";
import { walletStore } from "$lib/stores";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {WalletStore} */
  const original = await importOriginal();

  return {
    ...original,
    shieldedStatusStore: mockedShieldedStatusStore,
    walletStore: {
      ...mockedWalletStore,
      getStakeInfo: () => Promise.resolve(stakeInfo),
      getTransactionsHistory: () => Promise.resolve(transactions),
    },
  };
});

vi.useFakeTimers();

describe("Dashboard", () => {
  afterEach(() => {
    cleanup();
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: true,
      isPaused: false,
    });
  });

  afterAll(() => {
    vi.doUnmock("$lib/stores");
  });

  it("should render the dashboard page with the transactions after they are loaded", async () => {
    const { container } = renderWithSimpleContent(Dashboard, {});

    await vi.advanceTimersToNextTimerAsync();

    expect(container).toMatchSnapshot();
  });

  it("should render a card when there is an error getting transactions", async () => {
    const someError = new Error("some error message");
    const walletSpy = vi
      .spyOn(walletStore, "getTransactionsHistory")
      .mockRejectedValue(someError);
    const { container } = renderWithSimpleContent(Dashboard, {});

    await vi.advanceTimersToNextTimerAsync();

    expect(container).toMatchSnapshot();

    walletSpy.mockRestore();
  });

  it("should show a notice and hide Allocate while shielded transactions are paused", async () => {
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: true,
      isPaused: true,
    });

    const { getByRole, getByText, queryByRole } = renderWithSimpleContent(
      Dashboard,
      {}
    );

    await vi.advanceTimersToNextTimerAsync();

    expect(
      getByText("Shielded transactions are paused on this network.")
    ).toBeInTheDocument();
    expect(
      getByText("Your shielded DUSK stays where it is until they're back.")
    ).toBeInTheDocument();
    expect(queryByRole("link", { name: "Allocate" })).not.toBeInTheDocument();
    expect(getByRole("link", { name: "Send" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Receive" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Stake" })).toBeInTheDocument();
  });

  it("should show Allocate and no notice while shielded transactions aren't paused", async () => {
    const { getByRole, queryByText } = renderWithSimpleContent(Dashboard, {});

    await vi.advanceTimersToNextTimerAsync();

    expect(
      queryByText(/^Shielded transactions are paused/)
    ).not.toBeInTheDocument();
    expect(getByRole("link", { name: "Allocate" })).toBeInTheDocument();
  });

  it("should keep Allocate hidden, with no notice, until the node says if shielded transactions are paused", async () => {
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: false,
      isPaused: false,
    });

    const { getByRole, queryByRole, queryByText } = renderWithSimpleContent(
      Dashboard,
      {}
    );

    await vi.advanceTimersToNextTimerAsync();

    expect(queryByRole("link", { name: "Allocate" })).not.toBeInTheDocument();
    expect(getByRole("link", { name: "Send" })).toBeInTheDocument();
    expect(
      queryByText(/^Shielded transactions are paused/)
    ).not.toBeInTheDocument();
  });
});
