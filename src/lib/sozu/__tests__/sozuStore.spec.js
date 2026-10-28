import { afterEach, describe, expect, it, vi } from "vitest";

const { readSozuStatus } = vi.hoisted(() => ({
  readSozuStatus: vi.fn(async () => /** @type {SozuStatus | null} */ (null)),
}));

vi.mock("../status", () => ({ readSozuStatus }));

vi.mock("$lib/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
    networkStore: readable({ networkName: "testnet" }),
    walletStore: readable({ currentProfile: { account: "account-1" } }),
  };
});

describe("sozuStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    readSozuStatus.mockClear();
  });

  it("should read Sozu through the node's base path", async () => {
    vi.stubEnv("VITE_NODE_URL", "https://node.example/");
    vi.stubEnv("VITE_RUSK_PATH", "rusk");

    const { default: sozuStore } = await import("../sozuStore");

    await sozuStore.load();

    expect(readSozuStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "account-1",
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
