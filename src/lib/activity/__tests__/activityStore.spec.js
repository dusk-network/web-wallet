import { beforeEach, describe, expect, it, vi } from "vitest";

/** @type {typeof import("../activityStore")} */
let store;

beforeEach(async () => {
  vi.resetModules();
  store = await import("../activityStore");
  await store.activityDatabase.delete({ disableAutoOpen: false });
});

describe("activityStore", () => {
  it("forgets everything it keeps when the wallet is reset", async () => {
    const owner = store.activityOwnerKey("testnet", "acct");

    await store.commitActivityStep(
      owner,
      [
        /** @type {ActivityStoredEntry} */ ({
          blockHeight: 5,
          hash: "aa".repeat(32),
        }),
      ],
      () => /** @type {ActivityMeta} */ ({ covered: [[0, 9]] })
    );
    await store.putCounterpartyNames(
      "testnet",
      new Map([["acct2", "alice.dusk"]])
    );
    await store.putNoteHeightPool("testnet", [1, 2], 3);
    await store.putShieldedHistoryRecord("testnet::w::0", {
      decoys: [],
      entries: [],
      fingerprint: "x",
    });
    await store.putArchiveRefusal("https://node.example", 1);
    await store.putLocalTransaction(owner, {
      hash: "bb".repeat(32),
      kind: "transfer",
    });

    await store.clearActivityStore();

    expect(await store.getActivityMeta(owner)).toBeNull();
    expect(await store.listActivityEntries(owner)).toEqual([]);
    expect(await store.getCounterpartyNames("testnet", ["acct2"])).toEqual(
      new Map()
    );
    expect(await store.getNoteHeightPool("testnet")).toBeNull();
    expect(await store.getShieldedHistoryRecord("testnet::w::0")).toBeNull();
    expect(await store.getArchiveRefusal("https://node.example")).toBeNull();
    expect(await store.listLocalTransactions(owner)).toEqual([]);
  });

  it("counts each reset, so work that began before one writes nothing after it", async () => {
    const owner = store.activityOwnerKey("testnet", "acct");
    const epoch = await store.getActivityEpoch();

    await store.clearActivityStore();

    expect(await store.getActivityEpoch()).toBe(epoch + 1);
    await expect(
      store.putLocalTransaction(
        owner,
        { hash: "cc".repeat(32), kind: "transfer" },
        epoch
      )
    ).rejects.toBeInstanceOf(store.StaleActivityError);
    await expect(
      store.putCounterpartyNames("testnet", new Map([["acct", null]]), {
        epoch,
      })
    ).rejects.toBeInstanceOf(store.StaleActivityError);
    expect(await store.listLocalTransactions(owner)).toEqual([]);
  });

  it("keeps when a node answered without the archive", async () => {
    expect(await store.getArchiveRefusal("https://node.example")).toBeNull();

    await store.putArchiveRefusal("https://node.example", 42);

    expect(await store.getArchiveRefusal("https://node.example")).toBe(42);
    expect(await store.getArchiveRefusal("https://other.example")).toBeNull();
  });

  it("keeps the wallet's own transactions per account until the archive has them", async () => {
    const mine = store.activityOwnerKey("testnet", "acct");
    const other = store.activityOwnerKey("testnet", "acct2");
    const hash = "DD".repeat(32);

    await store.putLocalTransaction(mine, {
      amount: "5",
      hash,
      kind: "transfer",
      status: "submitted",
    });
    await store.putLocalTransaction(mine, { hash, status: "failed" });

    expect(await store.listLocalTransactions(mine)).toEqual([
      expect.objectContaining({
        amount: "5",
        hash: hash.toLowerCase(),
        kind: "transfer",
        status: "failed",
      }),
    ]);
    expect(await store.listLocalTransactions(other)).toEqual([]);

    await store.deleteLocalTransactions(mine, [hash]);

    expect(await store.listLocalTransactions(mine)).toEqual([]);
  });
});
