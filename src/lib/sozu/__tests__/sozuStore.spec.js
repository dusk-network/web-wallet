import { afterEach, describe, expect, it, vi } from "vitest";

const { followTransaction, readSozuStatus } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
  readSozuStatus: vi.fn(async () => /** @type {SozuStatus | null} */ (null)),
}));

vi.mock("../status", () => ({ readSozuStatus }));
vi.mock("$lib/transactions", () => ({ followTransaction }));

vi.mock("$lib/stores", async () => {
  const { readable } = await import("svelte/store");
  const { networks } = await import("@dusk-network/networks");

  return {
    networkStore: readable({ net: networks.testnet, networkName: "testnet" }),
    walletStore: readable({ currentProfile: { account: "account-1" } }),
  };
});

describe("sozuStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    readSozuStatus.mockClear();
  });

  it("should read again once a transaction's block is final, and not before", async () => {
    const { default: sozuStore } = await import("../sozuStore");

    await sozuStore.load({ force: true });
    readSozuStatus.mockClear();

    /** @type {(value: null) => void} */
    let final = () => {};

    followTransaction.mockReturnValueOnce(
      new Promise((resolve) => {
        final = resolve;
      })
    );

    const after = sozuStore.readAfter("a-hash");

    await Promise.resolve();

    expect(followTransaction).toHaveBeenCalledWith("a-hash");
    expect(readSozuStatus).not.toHaveBeenCalled();

    final(null);
    await after;

    expect(readSozuStatus).toHaveBeenCalledOnce();
  });

  it("should read again even if following the transaction failed", async () => {
    const { default: sozuStore } = await import("../sozuStore");

    await sozuStore.load({ force: true });
    readSozuStatus.mockClear();
    followTransaction.mockRejectedValueOnce(new Error("no connection"));

    await sozuStore.readAfter("a-hash");

    expect(readSozuStatus).toHaveBeenCalledOnce();
  });

  it("should read Sozu through the node's base path", async () => {
    vi.stubEnv("VITE_NODE_URL", "https://node.example/");
    vi.stubEnv("VITE_RUSK_PATH", "rusk");

    const { default: sozuStore } = await import("../sozuStore");

    await sozuStore.load();

    expect(readSozuStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "account-1",
        // Sozu's hub on the node's network, as its file names it.
        contracts: expect.objectContaining({
          hub: "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e",
        }),
        nodeUrl: "https://node.example/rusk",
      })
    );
  });

  it("should read Sozu again for a check, and give nothing when it couldn't, though the last status stays shown", async () => {
    const { default: sozuStore } = await import("../sozuStore");
    const { get } = await import("svelte/store");
    const read = /** @type {SozuStatus} */ (
      /** @type {unknown} */ ({ contracts: { pool: "a" } })
    );

    readSozuStatus.mockResolvedValueOnce(read);
    await sozuStore.load();
    readSozuStatus.mockResolvedValueOnce(read);

    await expect(sozuStore.check()).resolves.toBe(read);
    expect(readSozuStatus).toHaveBeenCalledTimes(2);

    readSozuStatus.mockRejectedValueOnce(new Error("offline"));

    await expect(sozuStore.check()).resolves.toBeNull();
    expect(get(sozuStore).status).toBe(read);
  });
});
