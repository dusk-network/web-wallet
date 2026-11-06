import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import NetworkPill from "../NetworkPill.svelte";

const sync = vi.hoisted(() => vi.fn(() => Promise.resolve()));

const pageStore = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  pageStore.page = writable({ state: {}, url: new URL("http://localhost/") });

  return { page: pageStore.page };
});

// A step of the history, as SvelteKit's shallow routing makes one.
vi.mock("$app/navigation", () => ({
  pushState: vi.fn((/** @type {string} */ _url, /** @type {any} */ state) =>
    pageStore.page?.update((page) => ({ ...page, state }))
  ),
}));

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

  it("opens its panel as a step of its own in the browser's history: phone Back closes it alone, and its own close takes that step back", async () => {
    const back = vi
      .spyOn(history, "back")
      .mockImplementation(() =>
        pageStore.page?.update((page) => ({ ...page, state: {} }))
      );
    const { getByRole, queryByRole } = render(NetworkPill);
    const pill = getByRole("button", { name: /testnet/i });

    await fireEvent.click(pill);

    expect(getByRole("dialog", { name: "Network" })).toBeInTheDocument();
    expect(get(/** @type {any} */ (pageStore.page)).state).toStrictEqual({
      networkPanel: true,
    });

    // Back: the panel closes, and the page stays where it was.
    await act(() => pageStore.page?.update((page) => ({ ...page, state: {} })));

    expect(queryByRole("dialog")).toBeNull();
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(get(/** @type {any} */ (pageStore.page)).url.pathname).toBe("/");
    expect(back).not.toHaveBeenCalled();

    // Its own close takes its step back.
    await fireEvent.click(pill);
    await fireEvent.keyDown(pill, { key: "Escape" });

    expect(queryByRole("dialog")).toBeNull();
    expect(back).toHaveBeenCalledOnce();

    back.mockRestore();
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
