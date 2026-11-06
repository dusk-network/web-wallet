import { afterEach, describe, expect, it, vi } from "vitest";

const { followTransaction, readSozuStatus, refreshBalance } = vi.hoisted(
  () => ({
    followTransaction: vi.fn(),
    readSozuStatus: vi.fn(async () => /** @type {SozuStatus | null} */ (null)),
    // The balances read again, with what's read along.
    refreshBalance: vi.fn(async () => {}),
  })
);

/** What the store reads along with the balances, as the wallet store calls it. */
const along = vi.hoisted(() => ({
  /** @type {((profile: any) => Promise<(() => void) | null>) | null} */
  read: null,
}));

vi.mock("../status", () => ({ readSozuStatus }));
vi.mock("$lib/transactions", () => ({ followTransaction }));

vi.mock("$lib/stores", async () => {
  const { readable } = await import("svelte/store");
  const { networks } = await import("@dusk-network/networks");

  return {
    networkStore: readable({ net: networks.testnet, networkName: "testnet" }),
    walletStore: {
      ...readable({ currentProfile: { account: "account-1" } }),
      readWithBalances: (
        /** @type {(profile: any) => Promise<(() => void) | null>} */ read
      ) => {
        along.read = read;

        return () => {};
      },
      refreshBalance,
    },
  };
});

describe("sozuStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    readSozuStatus.mockClear();
    refreshBalance.mockClear();
  });

  it("should read again with the balances once a transaction's block is final, and not before", async () => {
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
    expect(refreshBalance).not.toHaveBeenCalled();

    final(null);
    await after;

    // Read along with the balances, shown with them: never alone, which
    // would count what moved between them twice, or not at all.
    expect(refreshBalance).toHaveBeenCalledOnce();
    expect(readSozuStatus).not.toHaveBeenCalled();
  });

  it("should read again even if following the transaction failed", async () => {
    const { default: sozuStore } = await import("../sozuStore");

    await sozuStore.load({ force: true });
    readSozuStatus.mockClear();
    followTransaction.mockRejectedValueOnce(new Error("no connection"));

    await sozuStore.readAfter("a-hash");

    expect(refreshBalance).toHaveBeenCalledOnce();
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

  it("should read what's held again with the balances, for the account whose position shows, and show it with them", async () => {
    const { default: sozuStore } = await import("../sozuStore");
    const { get } = await import("svelte/store");
    /** @param {bigint} balance */
    const held = (balance) =>
      /** @type {SozuStatus} */ (
        /** @type {unknown} */ ({
          contracts: { pool: "a" },
          position: { balance, stDusk: 1n },
        })
      );
    const read = /** @type {NonNullable<typeof along.read>} */ (along.read);

    readSozuStatus.mockResolvedValueOnce(held(5n));
    await sozuStore.load({ force: true });
    readSozuStatus.mockClear();

    // Another profile's balances: nothing of this one's is read.
    expect(await read({ account: "account-2" })).toBeNull();
    expect(readSozuStatus).not.toHaveBeenCalled();

    // This one's: read now, shown only once the balances show.
    readSozuStatus.mockResolvedValueOnce(held(7n));

    const show = await read({ account: "account-1" });

    expect(readSozuStatus).toHaveBeenCalledOnce();
    expect(get(sozuStore).status?.position.balance).toBe(5n);

    show?.();

    expect(get(sozuStore).status?.position.balance).toBe(7n);

    // One that fails leaves what showed, and holds the balances no longer.
    readSozuStatus.mockRejectedValueOnce(new Error("offline"));

    expect(await read({ account: "account-1" })).toBeNull();
    expect(get(sozuStore).status?.position.balance).toBe(7n);
    sozuStore.reset();
  });

  describe("with a read along the balances and one of its own at once", () => {
    /** @param {bigint} balance */
    const held = (balance) =>
      /** @type {SozuStatus} */ (
        /** @type {unknown} */ ({
          contracts: { pool: "a" },
          position: { balance, stDusk: 1n },
        })
      );

    /** A read of Sozu that answers when a test says. */
    const answerLater = () => {
      const answer = Promise.withResolvers();

      readSozuStatus.mockImplementationOnce(() => answer.promise);

      return /** @param {SozuStatus} status */ (status) =>
        answer.resolve(status);
    };

    it("should show the newer of the two, whichever answers last: a read of its own begun after one along the balances", async () => {
      const { default: sozuStore } = await import("../sozuStore");
      const { get } = await import("svelte/store");
      const read = /** @type {NonNullable<typeof along.read>} */ (along.read);

      readSozuStatus.mockResolvedValueOnce(held(5n));
      await sozuStore.load({ force: true });

      // Along the balances first, then one of its own, which answers first.
      const older = answerLater();
      const showAlong = read({ account: "account-1" });
      const newer = answerLater();
      const loaded = sozuStore.load({ force: true });

      newer(held(9n));
      await loaded;
      older(held(7n));
      (await showAlong)?.();

      expect(get(sozuStore).status?.position.balance).toBe(9n);
      sozuStore.reset();
    });

    it("should show the newer of the two, whichever answers last: one along the balances begun after one of its own", async () => {
      const { default: sozuStore } = await import("../sozuStore");
      const { get } = await import("svelte/store");
      const read = /** @type {NonNullable<typeof along.read>} */ (along.read);

      readSozuStatus.mockResolvedValueOnce(held(5n));
      await sozuStore.load({ force: true });

      // One of its own first, then along the balances, which shows first.
      const older = answerLater();
      const loaded = sozuStore.load({ force: true });
      const newer = answerLater();
      const showAlong = read({ account: "account-1" });

      newer(held(9n));
      (await showAlong)?.();
      older(held(7n));
      await loaded;

      expect(get(sozuStore)).toMatchObject({
        loading: false,
        status: { position: { balance: 9n } },
      });
      sozuStore.reset();
    });
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
