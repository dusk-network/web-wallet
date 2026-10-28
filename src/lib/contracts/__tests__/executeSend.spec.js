import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { walletStore } from "$lib/stores";

import { executeSend } from "..";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      ...original.walletStore,
      transfer: vi.fn().mockResolvedValue({
        hash: "some-tx-id",
        nullifiers: [],
      }),
    },
  };
});

afterEach(() => {
  vi.mocked(walletStore.transfer).mockClear();
});

afterAll(() => {
  vi.doUnmock("$lib/stores/walletStore");
});

describe("executeSend", () => {
  it("should call the walletStore transfer method and execute the transaction", async () => {
    const duskAmount = 1000;
    const luxAmount = BigInt(duskAmount * 1e9);
    const result = await executeSend(
      "fake-address",
      luxAmount,
      "test memo",
      1n,
      500n
    );

    expect(walletStore.transfer).toHaveBeenCalledTimes(1);
    expect(walletStore.transfer).toHaveBeenCalledWith(
      "fake-address",
      luxAmount,
      "test memo",
      expect.objectContaining({
        limit: 500n,
        price: 1n,
      }),
      { toName: undefined }
    );
    expect(result).toBe("some-tx-id");
  });

  it("should pass on the .dusk name typed for the recipient, for the history", async () => {
    await executeSend("fake-address", 1n, "", 1n, 500n, "alice.dusk");

    expect(walletStore.transfer).toHaveBeenCalledWith(
      "fake-address",
      1n,
      "",
      expect.objectContaining({ limit: 500n, price: 1n }),
      { toName: "alice.dusk" }
    );
  });
});
