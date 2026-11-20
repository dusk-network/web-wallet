import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import Shell from "../Shell.svelte";

const mocks = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  network: null,
  startHistory: vi.fn(),
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  mocks.network = writable({ connected: true, networkName: "testnet" });

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      subscribe: mocks.network.subscribe,
    },
    walletStore: {
      ...original.walletStore,
      ...mockedWalletStore,
      startHistory: mocks.startHistory,
    },
  };
});

describe("Shell", () => {
  afterEach(() => {
    cleanup();
    mocks.startHistory.mockClear();
  });

  it("says at the top that test DUSK has no value, on a test network only", async () => {
    const { getByRole, queryByRole } = render(Shell);

    expect(getByRole("note")).toHaveTextContent("Testnet");

    await act(() =>
      mocks.network?.set({ connected: true, networkName: "mainnet" }),
    );

    expect(queryByRole("note")).toBeNull();

    await act(() =>
      mocks.network?.set({ connected: true, networkName: "testnet" }),
    );
  });

  it("keeps the current profile's history going", () => {
    render(Shell);

    expect(mocks.startHistory).toHaveBeenCalled();
  });
});
