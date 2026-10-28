import { afterEach, describe, expect, it, vi } from "vitest";

const { readSozuStatus } = vi.hoisted(() => ({
  readSozuStatus: vi.fn(async () => null),
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
});
