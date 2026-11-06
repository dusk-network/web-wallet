import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import NetworkPill from "../NetworkPill.svelte";

const sync = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: true, networkName: "testnet" }),
    },
    walletStore: { ...original.walletStore, ...mockedWalletStore, sync },
  };
});

describe("NetworkPill", () => {
  const initialState = mockedWalletStore.getMockedStoreValue();

  /** @param {Partial<WalletStoreContent["syncStatus"]>} status */
  const setSync = (status) =>
    act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialState,
        syncStatus: { ...initialState.syncStatus, ...status },
      })
    );

  beforeEach(() => {
    mockedWalletStore.setMockedStoreValue(initialState);
  });

  afterEach(() => {
    cleanup();
    sync.mockClear();
  });

  it("names the network in words, on a phone too, and says it is in sync", async () => {
    const { container, getByRole } = render(NetworkPill);

    // A screen reader hears what the button is, then the network and its sync.
    expect(
      getByRole("button", { name: "Network: Testnet, in sync" })
    ).toBeInTheDocument();
    expect(container.querySelector(".network-pill__dot--synced")).toBeTruthy();

    await setSync({ isInProgress: true, progress: 0.25 });

    expect(
      getByRole("button", { name: "Network: Testnet, syncing 25%" })
    ).toBeInTheDocument();

    await setSync({ error: new Error("The node is out of reach") });

    expect(
      getByRole("button", { name: "Network: Testnet, sync failed" })
    ).toBeInTheDocument();
  });

  it("says it's offline as soon as the browser is, what that means, and what the sync says once it's online again", async () => {
    const { container, getByRole, getByText, queryByRole } =
      render(NetworkPill);

    await act(() => window.dispatchEvent(new Event("offline")));

    expect(
      getByRole("button", { name: "Network: Testnet, offline" })
    ).toBeInTheDocument();
    expect(container.querySelector(".network-pill__dot--offline")).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: /testnet/i }));

    expect(getByText("Offline")).toBeInTheDocument();
    expect(
      getByText("Your balance may be out of date until you're back online.")
    ).toBeInTheDocument();
    // Nothing to try while offline: the sync starts once it's back.
    expect(queryByRole("button", { name: "Try again" })).toBeNull();

    await act(() => window.dispatchEvent(new Event("online")));

    expect(
      getByRole("button", { name: "Network: Testnet, in sync" })
    ).toBeInTheDocument();
  });

  it("shows the sync's progress while it runs", async () => {
    const { container, getByRole, getByText } = render(NetworkPill);

    await setSync({
      from: 100n,
      isInProgress: true,
      last: 200n,
      progress: 0.5,
    });
    await fireEvent.click(getByRole("button", { name: /testnet/i }));

    expect(container.querySelector(".network-pill__dot--syncing")).toBeTruthy();
    expect(getByText("Syncing 50%")).toBeInTheDocument();
    expect(container.querySelector(".sync-bar")).toBeTruthy();
  });

  it("says a sync failed, why, and tries again", async () => {
    const { getByRole, getByText } = render(NetworkPill);

    await setSync({ error: new Error("The node is out of reach") });
    await fireEvent.click(getByRole("button", { name: /testnet/i }));

    expect(getByText("Sync failed")).toBeInTheDocument();
    expect(getByText("The node is out of reach")).toBeInTheDocument();
    expect(getByText("Your balance may be out of date.")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(sync).toHaveBeenCalledOnce();
  });
});
