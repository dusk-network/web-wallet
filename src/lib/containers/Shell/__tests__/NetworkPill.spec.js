import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import networkReach from "$lib/stores/networkReach";

import NetworkPill from "../NetworkPill.svelte";

const sync = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const abortSync = vi.hoisted(() => vi.fn());
const refreshBalance = vi.hoisted(() => vi.fn(() => Promise.resolve()));

// The node, asked how far its chain got: it answers.
const askNode = vi.hoisted(() =>
  vi.fn(
    /** @type {(signal?: AbortSignal) => Promise<bigint>} */ (
      () => Promise.resolve(1n)
    )
  )
);

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
      getCurrentBlockHeight: askNode,
    },
    walletStore: {
      ...original.walletStore,
      ...mockedWalletStore,
      abortSync,
      refreshBalance,
      sync,
    },
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
    abortSync.mockClear();
    refreshBalance.mockClear();
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
    expect(get(networkReach)).toBe("offline");
    // In a word on the pill, not by its dot alone.
    expect(container.querySelector(".network-pill__button")).toHaveTextContent(
      "Testnet Offline"
    );

    await fireEvent.click(getByRole("button", { name: /testnet/i }));

    expect(getByRole("dialog", { name: "Network" })).toHaveTextContent(
      "Offline"
    );
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

  it("says it can't reach the network once a sync got nothing back for 30 seconds, and in sync once it answers", async () => {
    vi.useFakeTimers();

    try {
      const { container, getByRole } = render(NetworkPill);

      await setSync({ isInProgress: true, progress: 0 });
      await act(() => vi.advanceTimersByTimeAsync(29_000));

      expect(
        getByRole("button", { name: "Network: Testnet, syncing" })
      ).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(1_000));

      expect(
        getByRole("button", {
          name: "Network: Testnet, can't reach the network",
        })
      ).toBeInTheDocument();
      expect(
        container.querySelector(".network-pill__button")
      ).toHaveTextContent("Testnet Offline");
      // And where a send waits on it.
      expect(get(networkReach)).toBe("silent");

      await fireEvent.click(getByRole("button", { name: /testnet/i }));

      expect(getByRole("dialog", { name: "Network" })).toHaveTextContent(
        "Can't reach the network Your balance may be out of date. Try again"
      );

      // Something back, and it waits again.
      await setSync({ isInProgress: true, progress: 0.5 });

      expect(
        getByRole("button", { name: "Network: Testnet, syncing 50%" })
      ).toBeInTheDocument();

      await setSync({ isInProgress: false, progress: 1 });
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(
        getByRole("button", { name: "Network: Testnet, in sync" })
      ).toBeInTheDocument();
      expect(get(networkReach)).toBe("answering");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it can't reach the network once the node answered nothing for 30 seconds, between syncs too, and why on the pill, without a tap", async () => {
    vi.useFakeTimers();

    try {
      const { container, getByRole } = render(NetworkPill);
      const pill = () => container.querySelector(".network-pill__button");

      // In sync, the node answering.
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(
        getByRole("button", { name: "Network: Testnet, in sync" })
      ).toBeInTheDocument();

      // From here it answers nothing, and the wallet's next sync, 20 seconds
      // on, gets nothing back either.
      askNode.mockImplementation(() => new Promise(() => {}));
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      await setSync({ isInProgress: true, progress: 0 });
      await act(() => vi.advanceTimersByTimeAsync(9_000));

      expect(
        getByRole("button", { name: "Network: Testnet, syncing" })
      ).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(1_000));

      expect(
        getByRole("button", {
          name: "Network: Testnet, can't reach the network",
        })
      ).toBeInTheDocument();
      // Offline in a word on a phone; why where there's room.
      expect(pill()).toHaveTextContent(
        "Testnet Offline Can't reach the network"
      );

      // It answers again, and the sync gets through: in sync by its next ask.
      askNode.mockImplementation(() => Promise.resolve(1n));
      await setSync({ isInProgress: false, progress: 1 });
      await act(() => vi.advanceTimersByTimeAsync(15_000));

      expect(
        getByRole("button", { name: "Network: Testnet, in sync" })
      ).toBeInTheDocument();
      expect(pill()).toHaveTextContent(/^Testnet$/);
    } finally {
      askNode.mockImplementation(() => Promise.resolve(1n));
      vi.useRealTimers();
    }
  });

  it("asks the node one thing at a time, for 10 seconds at most, and nothing once the page hides", async () => {
    vi.useFakeTimers();

    // A node that holds every request open, without an answer.
    const node = { asked: 0, mostOpen: 0, open: 0 };

    askNode.mockImplementation(
      (/** @type {AbortSignal | undefined} */ signal) => {
        node.asked += 1;
        node.open += 1;
        node.mostOpen = Math.max(node.mostOpen, node.open);

        return new Promise((_, reject) =>
          signal?.addEventListener("abort", () => {
            node.open -= 1;
            reject(signal.reason);
          })
        );
      }
    );

    try {
      render(NetworkPill);
      await act(() => vi.advanceTimersByTimeAsync(55_000));

      // Asked again every 15 seconds, each ask stopped after 10.
      expect(node).toStrictEqual({ asked: 4, mostOpen: 1, open: 0 });

      await act(() => vi.advanceTimersByTimeAsync(5_000));

      expect(node.open).toBe(1);

      // Hidden, what's under way stops, and nothing more is asked.
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      await act(() => document.dispatchEvent(new Event("visibilitychange")));
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(node).toStrictEqual({ asked: 5, mostOpen: 1, open: 0 });
    } finally {
      // @ts-ignore The document's own, from its prototype again.
      delete document.visibilityState;
      askNode.mockImplementation(() => Promise.resolve(1n));
      vi.useRealTimers();
    }
  });

  it.each([
    ["the sync got nothing back for 30 seconds", 0],
    [
      "the node answered nothing for 30 seconds, before the sync's own 30",
      20_000,
    ],
  ])(
    "starts the sync again on Try again once %s, in place of the one under way, and shows the balances read after it",
    async (_, syncAfter) => {
      vi.useFakeTimers();

      // As the wallet's: a sync asked for while one runs joins that one,
      // until it's stopped, and the balances shown are read again after one
      // only where they're asked for with it.
      const wallet = { balancesRead: 0, running: 0, started: 0 };

      /** @type {PromiseWithResolvers<void> | null} */
      let current = null;

      const stop = () => {
        if (current) {
          wallet.running -= 1;
          current = null;
        }
      };

      sync.mockImplementation(() => {
        if (!current) {
          wallet.started += 1;
          wallet.running += 1;
          current = Promise.withResolvers();
        }

        return current.promise;
      });
      abortSync.mockImplementation(stop);
      refreshBalance.mockImplementation(() =>
        sync()
          .catch(() => {})
          .finally(() => {
            wallet.balancesRead += 1;
          })
      );

      if (syncAfter) {
        askNode.mockImplementation(() => new Promise(() => {}));
      }

      try {
        const { getByRole } = render(NetworkPill);

        // The wallet's sync, which gets nothing back.
        await act(() => vi.advanceTimersByTimeAsync(syncAfter));
        void sync();
        await setSync({ isInProgress: true, progress: 0 });
        await act(() => vi.advanceTimersByTimeAsync(30_000 - syncAfter));
        await fireEvent.click(getByRole("button", { name: /testnet/i }));
        await fireEvent.click(getByRole("button", { name: "Try again" }));

        // Another runs, alone.
        expect(wallet).toStrictEqual({
          balancesRead: 0,
          running: 1,
          started: 2,
        });

        // Once it's done, the balances shown are the ones it read.
        const replacement = /** @type {PromiseWithResolvers<void> | null} */ (
          current
        );

        stop();
        replacement?.resolve();

        await vi.waitFor(() => expect(wallet.balancesRead).toBe(1));
      } finally {
        askNode.mockImplementation(() => Promise.resolve(1n));
        sync.mockImplementation(() => Promise.resolve());
        refreshBalance.mockImplementation(() => Promise.resolve());
        abortSync.mockReset();
        vi.useRealTimers();
      }
    }
  );

  it("says a sync that couldn't reach the network did so in plain words, not the browser's", async () => {
    const { getByRole, queryByText } = render(NetworkPill);

    await setSync({ error: new TypeError("Failed to fetch") });
    await fireEvent.click(getByRole("button", { name: /testnet/i }));

    expect(getByRole("dialog", { name: "Network" })).toHaveTextContent(
      "Can't reach the network Your balance may be out of date. Try again"
    );
    expect(queryByText(/Failed to fetch/)).toBeNull();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(refreshBalance).toHaveBeenCalledOnce();
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

  it("closes its panel on Escape wherever the focus is in it, as on Try again, so the next press outside does what it's for", async () => {
    vi.useFakeTimers();

    const back = vi
      .spyOn(history, "back")
      .mockImplementation(() =>
        pageStore.page?.update((page) => ({ ...page, state: {} }))
      );
    const outside = document.createElement("button");
    const pressed = vi.fn();

    outside.addEventListener("click", pressed);
    document.body.append(outside);

    try {
      const { getByRole, queryByRole } = render(NetworkPill);

      // The node silent: the sync stalls, and the pill says so.
      await setSync({ isInProgress: true, progress: 0 });
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      await fireEvent.click(getByRole("button", { name: /testnet/i }));

      const tryAgain = getByRole("button", { name: "Try again" });

      await fireEvent.click(tryAgain);
      tryAgain.focus();
      await fireEvent.keyDown(document.activeElement ?? tryAgain, {
        key: "Escape",
      });

      expect(queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(
        getByRole("button", { name: /testnet/i })
      );

      // Send, say: pressed once, it does what it's for.
      await fireEvent.click(outside);

      expect(pressed).toHaveBeenCalledOnce();
    } finally {
      outside.remove();
      back.mockRestore();
      vi.useRealTimers();
    }
  });

  it("says Try again is at it until what it began ends, and offers it again once the network is found silent again", async () => {
    vi.useFakeTimers();

    try {
      const { getByRole } = render(NetworkPill);
      /** @type {PromiseWithResolvers<void>} */
      const tried = Promise.withResolvers();

      await setSync({ isInProgress: true, progress: 0 });
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      await fireEvent.click(getByRole("button", { name: /testnet/i }));

      refreshBalance.mockReturnValueOnce(tried.promise);
      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(getByRole("button", { name: "Trying again…" })).toBeDisabled();

      // Its sync gets nothing back either: Try again again.
      await setSync({ isInProgress: true, progress: 0 });
      await act(() => vi.advanceTimersByTimeAsync(30_000));

      expect(getByRole("button", { name: "Try again" })).toBeEnabled();

      // And once what it began ends.
      refreshBalance.mockReturnValueOnce(tried.promise);
      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(getByRole("button", { name: "Trying again…" })).toBeDisabled();

      await act(() => tried.resolve());

      expect(getByRole("button", { name: "Try again" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
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

    expect(getByRole("dialog", { name: "Network" })).toHaveTextContent(
      /^Dusk Testnet Sync failed/
    );
    expect(getByText("The node is out of reach")).toBeInTheDocument();
    expect(getByText("Your balance may be out of date.")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(refreshBalance).toHaveBeenCalledOnce();
  });
});
