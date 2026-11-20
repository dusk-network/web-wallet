import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import networkReach from "$lib/stores/networkReach";

import NetworkPill from "../NetworkPill.svelte";

// The node, asked how far its chain got: it answers.
const askNode = vi.hoisted(() =>
  vi.fn(
    /** @type {(signal?: AbortSignal) => Promise<bigint>} */ (
      () => Promise.resolve(1n)
    ),
  ),
);

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
      }),
    );

  beforeEach(() => {
    mockedWalletStore.setMockedStoreValue(initialState);
  });

  afterEach(cleanup);

  it("names the network it's on", () => {
    const { getByRole } = render(NetworkPill);

    expect(getByRole("button", { name: /Testnet/ })).toBeInTheDocument();
  });

  it("says it's offline as soon as the browser is, and that it answers once it's online again", async () => {
    render(NetworkPill);

    await act(() => window.dispatchEvent(new Event("offline")));

    expect(get(networkReach)).toBe("offline");

    await act(() => window.dispatchEvent(new Event("online")));

    expect(get(networkReach)).toBe("answering");
  });

  it("says it can't reach the network once a sync got nothing back for 30 seconds, and in sync once it answers", async () => {
    vi.useFakeTimers();

    try {
      render(NetworkPill);

      await setSync({ isInProgress: true, progress: 0 });
      await act(() => vi.advanceTimersByTimeAsync(29_000));

      expect(get(networkReach)).toBe("answering");

      await act(() => vi.advanceTimersByTimeAsync(1_000));

      // Not offline, as a phone with bars isn't: silent, where a send waits
      // on it.
      expect(get(networkReach)).toBe("silent");

      // Something back, and it waits again.
      await setSync({ isInProgress: true, progress: 0.5 });

      expect(get(networkReach)).toBe("answering");

      await setSync({ isInProgress: false, progress: 1 });
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(get(networkReach)).toBe("answering");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps saying it can't reach the network while a stalled sync gets nothing back as the node still answers how far its chain got, whatever else the wallet says meanwhile", async () => {
    vi.useFakeTimers();

    try {
      render(NetworkPill);

      await setSync({ isInProgress: true, progress: 0.25 });
      await act(() => vi.advanceTimersByTimeAsync(30_000));

      expect(get(networkReach)).toBe("silent");

      // As the wallet does once it's said: its balances may be out of date,
      // its sync as it was.
      await act(() =>
        mockedWalletStore.setMockedStoreValue({
          ...mockedWalletStore.getMockedStoreValue(),
          balanceReadFailed: true,
          stakeReadFailed: true,
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(20_000));

      expect(askNode).toHaveBeenCalled();
      expect(get(networkReach)).toBe("silent");

      // Something back, and it waits again.
      await setSync({ isInProgress: true, progress: 0.5 });

      expect(get(networkReach)).toBe("answering");
    } finally {
      vi.useRealTimers();
    }
  });

  // Chen's and Marek's: on a silent network the total was marked out of
  // date after 18 to 22 seconds, not about 10.
  it("says it can't reach the network within 10 seconds of the node going silent, as an ask goes unanswered for the 6 seconds it gets, between syncs too", async () => {
    vi.useFakeTimers();

    try {
      render(NetworkPill);

      // In sync, the node answering.
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(get(networkReach)).toBe("answering");

      // From here it answers nothing: its next ask, 4 seconds on, gets no
      // answer in 6 seconds.
      askNode.mockImplementation(() => new Promise(() => {}));
      await act(() => vi.advanceTimersByTimeAsync(9_000));

      expect(get(networkReach)).toBe("answering");

      await act(() => vi.advanceTimersByTimeAsync(1_000));

      expect(get(networkReach)).toBe("silent");

      // It answers again: in sync by its next ask.
      askNode.mockImplementation(() => Promise.resolve(1n));
      await act(() => vi.advanceTimersByTimeAsync(4_000));

      expect(get(networkReach)).toBe("answering");
    } finally {
      askNode.mockImplementation(() => Promise.resolve(1n));
      vi.useRealTimers();
    }
  });
});
