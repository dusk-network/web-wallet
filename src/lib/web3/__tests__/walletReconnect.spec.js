import { describe, expect, it, vi } from "vitest";

const { disconnected, reconnecting } = vi.hoisted(() => ({
  disconnected: vi.fn(),
  /** @type {PromiseWithResolvers<unknown[]>} */
  reconnecting: Promise.withResolvers(),
}));

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {typeof import("@wagmi/core")} */ (await importOriginal()),
  disconnect: disconnected,
  reconnect: vi.fn(() => reconnecting.promise),
}));

describe("startWalletConnection, for a wallet connected before", () => {
  it("should let the pages in only once the wallet has reconnected", async () => {
    const { startWalletConnection } = await import("../walletConnection");
    const { networks } = await import("@dusk-network/networks");

    (await import("$lib/stores/nodeNetwork")).setNodeNetwork(networks.testnet);

    let started = false;

    const start = startWalletConnection().then(() => {
      started = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(started).toBe(false);

    reconnecting.resolve([]);
    await start;

    expect(started).toBe(true);
  });

  it("should keep the wallet when Stay is chosen as the page asks whether to leave, and disconnect it only as the page goes", async () => {
    const { startWalletConnection } = await import("../walletConnection");

    await startWalletConnection();

    // The browser asks; Stay is chosen, and nothing more comes.
    window.dispatchEvent(new Event("beforeunload", { cancelable: true }));

    expect(disconnected).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));

    expect(disconnected).toHaveBeenCalledOnce();
  });
});
