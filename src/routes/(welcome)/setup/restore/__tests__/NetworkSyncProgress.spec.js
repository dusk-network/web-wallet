import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { walletStore } from "$lib/stores";
import * as navigation from "$lib/navigation";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import NetworkSyncProgress from "../NetworkSyncProgress.svelte";

const initial = mockedWalletStore.getMockedStoreValue();

function showFailure() {
  vi.spyOn(walletStore, "subscribe").mockImplementation(
    mockedWalletStore.subscribe,
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

  it("should retry from the selected height", async () => {
    showFailure();
    const sync = vi.spyOn(walletStore, "sync").mockResolvedValue(undefined);
    const { getByRole } = render(NetworkSyncProgress, {
      fromBlock: 123n,
    });
    await fireEvent.click(
      getByRole("button", { name: "Retry synchronization" }),
    );
    expect(sync).toHaveBeenCalledWith(123n);
  });

  it("should offer the existing logout path after failure, even when mounted after sync ended", async () => {
    showFailure();
    const logout = vi.spyOn(navigation, "logout").mockResolvedValue();
    const { getByRole } = render(NetworkSyncProgress);
    await fireEvent.click(
      getByRole("button", { name: "Lock wallet and exit" }),
    );
    expect(logout).toHaveBeenCalledWith(false);
  });
});
