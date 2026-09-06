import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { walletStore } from "$lib/stores";
import * as navigation from "$lib/navigation";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import NetworkSyncProgress from "../NetworkSyncProgress.svelte";

const initial = mockedWalletStore.getMockedStoreValue();

function showFailure() {
  vi.spyOn(walletStore, "subscribe").mockImplementation(
    mockedWalletStore.subscribe
  );
  mockedWalletStore.setMockedStoreValue({
    ...initial,
    syncStatus: { ...initial.syncStatus, error: new Error("Offline") },
  });
}

describe("Restore sync recovery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockedWalletStore.setMockedStoreValue(initial);
  });

  it("should retry from the selected height and show progress then completion", async () => {
    showFailure();
    const sync = vi.spyOn(walletStore, "sync").mockImplementation(async () => {
      mockedWalletStore.setMockedStoreValue({
        ...initial,
        syncStatus: { ...initial.syncStatus, isInProgress: true },
      });
    });
    const { getByRole, getByText, queryByRole } = render(NetworkSyncProgress, {
      fromBlock: 123n,
    });
    await fireEvent.click(
      getByRole("button", { name: "Retry synchronization" })
    );
    expect(sync).toHaveBeenCalledWith(123n);
    expect(getByText("Syncing...")).toBeInTheDocument();
    expect(queryByRole("button", { name: "Retry synchronization" })).toBeNull();
    mockedWalletStore.setMockedStoreValue(initial);
    await tick();
    expect(getByText("Sync completed!")).toBeInTheDocument();
  });

  it("should offer the existing logout path after failure, even when mounted after sync ended", async () => {
    showFailure();
    const logout = vi.spyOn(navigation, "logout").mockResolvedValue();
    const { getByRole } = render(NetworkSyncProgress);
    await fireEvent.click(
      getByRole("button", { name: "Lock wallet and exit" })
    );
    expect(logout).toHaveBeenCalledWith(false);
  });
});
