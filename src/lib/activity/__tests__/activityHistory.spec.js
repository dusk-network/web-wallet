import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bridgeCalls from "../../bridge/__tests__/fixtures/bridge-calls-testnet.json";
import fixture from "./fixtures/activity-testnet.json";
import { fakeArchive } from "./fixtures/fakeArchive";
import { calls as REGISTRATIONS } from "./fixtures/registrations-testnet.json";
import { networks } from "@dusk-network/networks";

/*
 * Recorded on Testnet: A registered a .dusk name and received two transfers;
 * B has years of transfers, contract calls, a shield, stake rewards and an
 * unstake; Z received an unshield.
 */
const [A, B, Z] = Object.keys(fixture.accounts);
const NODE = fixture.nodeUrl;
const FINALIZED = Number(fixture.head.last_finalized_block[0]);
const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";
const DUSK = 1_000_000_000n;

/** @type {Record<string, { receiver: any[], sender: any[] }>} */
const accounts = /** @type {any} */ (fixture.accounts);

/** @type {typeof import("../activityHistory")} */
let history;

/** @type {typeof import("../activityStore")} */
let store;

/** @type {typeof import("$lib/stores/nodeNetwork").setNodeNetwork} */
let setNodeNetwork;

beforeEach(async () => {
  // A new database per test, and fresh modules, on a testnet node: the
  // recordings' network.
  vi.resetModules();
  store = await import("../activityStore");
  await store.activityDatabase.delete({ disableAutoOpen: false });
  history = await import("../activityHistory");
  ({ setNodeNetwork } = await import("$lib/stores/nodeNetwork"));
  setNodeNetwork(networks.testnet);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * @param {string} account
 * @param {"in" | "out"} direction
 * @returns {any[]}
 */
const entriesOf = (account, direction) =>
  accounts[account][direction === "out" ? "sender" : "receiver"];

/**
 * @param {string} account
 * @param {number} height
 */
const entryAt = (account, height) =>
  [...entriesOf(account, "out"), ...entriesOf(account, "in")].find(
    (e) => e.block_height === height
  );

/** @param {string} account */
const uniqueHashes = (account) =>
  new Set(
    [...entriesOf(account, "out"), ...entriesOf(account, "in")].map(
      (e) => e.origin
    )
  );

/**
 * @param {string} account
 * @param {Partial<Parameters<typeof history.syncActivity>[0]>} [options]
 */
const sync = (account, options = {}) =>
  history.syncActivity({ account, nodeUrl: NODE, ...options });

/** @param {string} account */
const kept = (account) =>
  store.listActivityEntries(store.activityOwnerKey("testnet", account), {
    limit: 10_000,
  });

describe("parseHistoryEntry", () => {
  /**
   * @param {string} account
   * @param {number} height
   */
  const parse = (account, height) =>
    history.parseHistoryEntry(account, entryAt(account, height));

  it("reads a transfer received, with its sender", () => {
    expect(parse(A, 4655845)).toEqual({
      blockHeight: 4655845,
      counterparty: entryAt(A, 4655845).events[0].data.sender,
      direction: "in",
      hash: "8e247a33967153b229ce4f45f61e0f14808d8a417c4a4b37eabb269a8eb08e34",
      kind: "transfer",
      memo: "",
      payer: false,
      value: 1100n * DUSK,
    });
  });

  it("reads a contract call's deposit as what was sent, and a call without one as fee only", () => {
    expect(parse(A, 4658012)).toMatchObject({
      counterparty: STORE,
      direction: "out",
      kind: "contract_call",
      payer: true,
      value: 100n * DUSK,
    });
    expect(parse(A, 4658000)).toMatchObject({
      counterparty: null,
      direction: "out",
      kind: "contract_call",
      payer: true,
      value: 0n,
    });
  });

  it("reads a transfer sent, and one without a receiver as sent to the account itself, with its memo", () => {
    const sent = entriesOf(B, "out").find((e) =>
      e.events.some(
        (/** @type {any} */ ev) =>
          ev.topic === "moonlight" && ev.data.receiver && ev.data.value !== "0"
      )
    );

    expect(history.parseHistoryEntry(B, sent)).toMatchObject({
      counterparty: sent.events.at(-1).data.receiver,
      direction: "out",
      kind: "transfer",
    });

    // dusk-core leaves the receiver out when it is the sender.
    expect(parse(B, 2517146)).toMatchObject({
      counterparty: B,
      direction: "self",
      kind: "transfer",
      memo: "extension test",
      value: DUSK,
    });
  });

  it("reads a shield as sent to the shielded address, and an unshield as received", () => {
    expect(parse(B, 2517213)).toMatchObject({
      counterparty:
        "3rTbMbu2ffd3kuUiq766HJBh3eYHpKbwZFZtXLFtadRMFw6dLqxAUr1n5PtAXfb3xnBhGssELCC64cxd4dSYyjEj",
      direction: "out",
      kind: "shield",
      value: 13_351_700_000n,
    });
    expect(parse(Z, 3602438)).toMatchObject({
      counterparty: null,
      direction: "in",
      kind: "unshield",
      payer: false,
      value: 8_987_551_049n,
    });
  });

  it("names stake rewards and unstakes from the stake contract's events", () => {
    expect(parse(B, 3412754)).toMatchObject({
      direction: "in",
      kind: "withdraw_reward",
      value: 1_609_142_758_405_397n,
    });
    expect(parse(B, 4643699)).toMatchObject({
      direction: "in",
      kind: "unstake",
      value: 500_000n * DUSK,
    });
  });

  it("reads a deposit to the stake contract as a stake", () => {
    // Derived from B's deposit to a contract: the same events, to the stake contract.
    const entry = structuredClone(entryAt(B, 3412903));

    entry.events.find(
      (/** @type {any} */ e) => e.topic === "deposit"
    ).data.receiver = history.STAKE_CONTRACT;
    entry.events.push({
      data: {},
      reverted: false,
      target: history.STAKE_CONTRACT,
      topic: "stake",
    });

    expect(history.parseHistoryEntry(B, entry)).toMatchObject({
      direction: "out",
      kind: "stake",
      value: 1000n * DUSK,
    });
  });

  it("leaves reverted events out", () => {
    // Derived from A's registration: a call that failed after taking its
    // deposit, which the archive flags as reverted, keeps the deposit.
    const entry = structuredClone(entryAt(A, 4658012));

    entry.events.find(
      (/** @type {any} */ e) => e.topic === "deposit"
    ).reverted = true;

    expect(history.parseHistoryEntry(A, entry)).toMatchObject({
      direction: "out",
      kind: "contract_call",
      value: 0n,
    });
  });

  it("refuses entries without a hash or height", () => {
    expect(
      history.parseHistoryEntry(A, { ...entryAt(A, 4655845), origin: "nope" })
    ).toBeNull();
    expect(
      history.parseHistoryEntry(A, {
        ...entryAt(A, 4655845),
        // eslint-disable-next-line camelcase
        block_height: -1,
      })
    ).toBeNull();
  });
});

describe("coverage", () => {
  it("joins touching ranges and finds the highest gap", () => {
    let covered = history.addCoverage([], 100, 200);

    covered = history.addCoverage(covered, 0, 49);
    expect(covered).toEqual([
      [100, 200],
      [0, 49],
    ]);
    expect(history.topGap(covered, 300)).toEqual([201, 300]);
    expect(history.topGap(covered, 200)).toEqual([50, 99]);

    covered = history.addCoverage(covered, 50, 99);
    expect(covered).toEqual([[0, 200]]);
    expect(history.topGap(covered, 200)).toBeNull();
    expect(
      history.shownDownTo(
        [
          [150, 300],
          [0, 99],
        ],
        300
      )
    ).toBe(150);
  });
});

describe("syncActivity", () => {
  it("syncs an account from the newest window down, widening while it is sparse", async () => {
    const node = fakeArchive();
    const result = await sync(A);
    const target = FINALIZED - history.FINALITY_MARGIN;
    const windows = node
      .historyQueries()
      .map((l) =>
        [...l.query.matchAll(/fromBlock: (\d+), toBlock: (\d+)/g)][0]
          .slice(1)
          .map(Number)
      );

    // A day, then each window 8 times wider while it held few entries.
    expect(windows).toEqual([
      [target - 8_639, target],
      [target - 8_640 - 69_119, target - 8_640],
      [target - 77_760 - 552_959, target - 77_760],
      [0, target - 630_720],
    ]);

    // The head, four windows, and the details of the four entries found, at once.
    expect(
      node.log.map((l) =>
        l.query.includes("lastBlockPair")
          ? "head"
          : l.query.includes("tx(hash:")
            ? "details"
            : "window"
      )
    ).toEqual(["head", "window", "window", "details", "window", "window"]);
    expect(result.meta.covered).toEqual([[0, target]]);

    const read = await history.readActivity({ account: A, nodeUrl: NODE });

    expect(read.complete).toBe(true);
    expect(
      read.entries.map((e) => [e.blockHeight, e.direction, e.kind, e.value])
    ).toEqual([
      [4658012, "out", "contract_call", 100n * DUSK],
      [4658000, "out", "contract_call", 0n],
      [4657992, "in", "transfer", 1000n * DUSK],
      [4655845, "in", "transfer", 1100n * DUSK],
    ]);

    const [register, commit] = read.entries;

    expect(register).toMatchObject({
      contractId: STORE,
      fee: 2_897_558n,
      fnName: "register",
      success: true,
      timestamp: 1_792_687_511_000,
    });
    expect(commit).toMatchObject({
      fee: 1_959_593n,
      fnName: "commit",
      success: true,
    });

    // A fee is the sender's: none on what the account received.
    expect(read.entries[2].fee).toBeNull();
  });

  it("narrows a window whose page fills, and keeps every entry over the runs that follow", async () => {
    const node = fakeArchive();
    const all = uniqueHashes(B);

    for (let run = 0; run < 6; run++) {
      const before = node.log.length;

      await sync(B);

      const queries = node.log.slice(before);

      expect(
        queries.filter((l) => !l.query.includes("tx(hash:")).length
      ).toBeLessThanOrEqual(history.RUN_REQUESTS);
      expect(
        queries.filter((l) => l.query.includes("tx(hash:")).length
      ).toBeLessThanOrEqual(history.RUN_DETAIL_REQUESTS);

      // Whatever is shown is everything at those heights: no gap above the lowest.
      const read = await history.readActivity({
        account: B,
        limit: 1_000,
        nodeUrl: NODE,
      });
      const shownFrom = Number(read.coveredTo);
      const truth = [...all].filter((h) => {
        const e = [...entriesOf(B, "out"), ...entriesOf(B, "in")].find(
          (x) => x.origin === h
        );

        return e.block_height >= shownFrom;
      });

      expect(new Set(read.entries.map((e) => e.hash))).toEqual(new Set(truth));

      if (read.complete) {
        break;
      }
    }

    // Some window filled its page of 50.
    expect(
      node
        .historyQueries()
        .some((l) => (l.data.out?.json?.length ?? 0) === history.PAGE)
    ).toBe(true);

    const rows = await kept(B);

    expect(rows.length).toBe(all.size);
    expect(new Set(rows.map((r) => r.hash))).toEqual(all);

    const read = await history.readActivity({
      account: B,
      limit: 1_000,
      nodeUrl: NODE,
    });

    expect(read.complete).toBe(true);

    // Heights strictly in order, newest first.
    expect(read.entries.map((e) => e.blockHeight)).toEqual(
      [...read.entries.map((e) => e.blockHeight)].sort((x, y) => y - x)
    );
  });

  it("asks only above the heights it kept on a refresh", async () => {
    const node = fakeArchive({ finalized: 4_656_000 });

    await sync(A);
    expect(
      (await history.readActivity({ account: A, nodeUrl: NODE })).entries.map(
        (e) => e.blockHeight
      )
    ).toEqual([4655845]);

    node.finalized = FINALIZED;

    const before = node.log.length;
    const result = await sync(A);
    const refresh = node.log.slice(before);

    // One request has the head and everything above the kept heights; one more has the new entries' details.
    expect(refresh).toHaveLength(2);
    expect(refresh[0].query).toContain("pair: lastBlockPair { json }");
    expect(refresh[0].query).toContain(
      `moonlightHistory(sender: "${A}", fromBlock: ${4_656_000 - history.FINALITY_MARGIN + 1}, maxCount: 50)`
    );
    expect(refresh[0].query).not.toContain("toBlock");
    expect(refresh[1].query.match(/tx\(hash:/g)).toHaveLength(3);
    expect(result.meta.covered).toEqual([
      [0, FINALIZED - history.FINALITY_MARGIN],
    ]);
    expect(
      (await history.readActivity({ account: A, nodeUrl: NODE })).entries.map(
        (e) => e.blockHeight
      )
    ).toEqual([4658012, 4658000, 4657992, 4655845]);
  });

  it("reads entries in the finality margin again without keeping them twice", async () => {
    // 4658012 is above the first refresh's target and read again by the next.
    const node = fakeArchive({ finalized: 4_658_000 });

    await sync(A);
    node.finalized = 4_658_020;
    await sync(A);
    node.finalized = FINALIZED;

    const before = node.detailQueries().length;

    await sync(A);

    const twice = node
      .historyQueries()
      .filter((l) =>
        l.data.out?.json?.some(
          (/** @type {any} */ e) => e.block_height === 4658012
        )
      );

    expect(twice).toHaveLength(2);

    const rows = await kept(A);

    expect(rows.filter((r) => r.blockHeight === 4658012)).toHaveLength(1);
    expect(rows).toHaveLength(4);

    // Its details stayed with it: none looked up again.
    expect(node.detailQueries().length).toBe(before);
    expect(rows.find((r) => r.blockHeight === 4658012)).toMatchObject({
      fnName: "register",
    });
  });

  it("stops at its request budget and carries on in the next run", async () => {
    const node = fakeArchive();

    await sync(A, { maxDetailRequests: 0, maxRequests: 2 });
    expect(node.log).toHaveLength(2);

    let read = await history.readActivity({ account: A, nodeUrl: NODE });

    expect(read.complete).toBe(false);

    await sync(A, { maxRequests: 3 });
    read = await history.readActivity({ account: A, nodeUrl: NODE });
    expect(read.entries).toHaveLength(4);
    expect(await kept(A)).toHaveLength(4);
  });

  it("starts over when the node's chain is another one, forgetting all kept of the old one", async () => {
    const node = fakeArchive();

    await sync(A);
    await sync(B);

    // What else the old chain left: a send, a shielded history and the note
    // tree's heights; and a send on another network.
    const ownerKey = store.activityOwnerKey("testnet", A);
    const elsewhere = store.activityOwnerKey("devnet", A);
    const send = {
      amount: "1",
      hash: "ab".repeat(32),
      kind: /** @type {const} */ ("transfer"),
      privacy: /** @type {const} */ ("public"),
      status: /** @type {const} */ ("submitted"),
      submittedAt: 1,
    };

    await store.putLocalTransaction(ownerKey, send);
    await store.putLocalTransaction(elsewhere, send);
    await store.putShieldedHistoryRecord("testnet::the-address", {
      decoys: [],
      entries: [],
      fingerprint: "f",
    });
    await store.putNoteHeightPool("testnet", [1, 2, 3], 3);

    node.genesis = "ff".repeat(32);
    node.finalized = 4_656_000;
    await sync(A);

    const rows = await kept(A);

    expect(rows.map((r) => r.blockHeight)).toEqual([4655845]);
    expect(await kept(B)).toEqual([]);
    expect(
      await store.getActivityMeta(store.activityOwnerKey("testnet", B))
    ).toBeNull();
    expect(await store.listLocalTransactions(ownerKey)).toEqual([]);
    expect(await store.listLocalTransactions(elsewhere)).toHaveLength(1);
    expect(
      await store.getShieldedHistoryRecord("testnet::the-address")
    ).toBeNull();
    expect(await store.getNoteHeightPool("testnet")).toBeNull();
  });
});

describe("a wallet reset during a sync", () => {
  it("keeps nothing the sync reads after it", async () => {
    const node = fakeArchive();

    const held = Promise.withResolvers();
    const atWindow = Promise.withResolvers();

    node.before = async (query) => {
      if (query.includes("toBlock")) {
        atWindow.resolve(undefined);
        await held.promise;
      }
    };

    const run = sync(A);

    await atWindow.promise;
    await store.clearActivityStore();
    held.resolve(undefined);

    await expect(run).rejects.toBeInstanceOf(store.StaleActivityError);
    expect(await kept(A)).toEqual([]);
    expect(
      await store.getActivityMeta(store.activityOwnerKey("testnet", A))
    ).toBeNull();
  });

  it("keeps nothing when the node's chain changed too", async () => {
    const node = fakeArchive();

    await sync(A);

    // The next run's first request waits; the wallet is reset meanwhile,
    // and the node answers for another chain.
    const held = Promise.withResolvers();
    const reached = Promise.withResolvers();

    node.before = async () => {
      reached.resolve(undefined);
      await held.promise;
    };

    const run = sync(A);

    await reached.promise;
    await store.clearActivityStore();
    node.before = null;
    node.genesis = "ff".repeat(32);
    held.resolve(undefined);

    await expect(run).rejects.toBeInstanceOf(store.StaleActivityError);
    expect(await kept(A)).toEqual([]);
    expect(
      await store.getActivityMeta(store.activityOwnerKey("testnet", A))
    ).toBeNull();
  });
});

describe("a block with more than a page of the account's entries", () => {
  // Derived: 450 transfers from B in one block, each a copy of one recorded
  // entry with its own hash, more than one run's requests can page through.
  const H = 4_600_000;
  const template = entriesOf(B, "out").find((e) => e.events.length === 1);
  const crowded = Array.from({ length: 450 }, (_, i) => ({
    ...template,
    // eslint-disable-next-line camelcase
    block_height: H,
    origin: i.toString(16).padStart(64, "0"),
  }));

  it("carries on paging it where the last run stopped", async () => {
    const node = fakeArchive({
      accounts: { [B]: { receiver: [], sender: crowded } },
      finalized: H + 20,
    });

    for (let run = 0; run < 4; run++) {
      await sync(B);
    }

    const rows = await kept(B);

    expect(rows).toHaveLength(450);

    const read = await history.readActivity({
      account: B,
      limit: 1_000,
      nodeUrl: NODE,
    });

    expect(read.complete).toBe(true);

    // No page of the block was read twice: each run carried on where the last stopped.
    const pages = node
      .historyQueries()
      .map((l) => l.query.match(/pageCount: (\d+)/)?.[1])
      .filter(Boolean);

    expect(pages.length).toBeGreaterThan(0);
    expect(new Set(pages).size).toBe(pages.length);

    // Four runs over 450 entries: time to spare under a full test run's load.
  }, 20_000);
});

describe("a node without the archive", () => {
  it("is asked nothing for an hour after its first refusal, then again", async () => {
    const node = fakeArchive();
    const now = vi.spyOn(Date, "now");

    node.archive = false;
    now.mockReturnValue(1_000_000_000);

    await expect(sync(A)).rejects.toBeInstanceOf(history.NoArchiveError);

    // The head, then the first window it refused.
    expect(node.log).toHaveLength(2);
    await expect(sync(A)).rejects.toBeInstanceOf(history.NoArchiveError);
    expect(node.log).toHaveLength(2);

    // An hour on, it is asked again: now with the archive.
    now.mockReturnValue(1_000_000_000 + history.NO_ARCHIVE_RETRY_MS);
    node.archive = true;
    await sync(A);
    expect(
      (await history.readActivity({ account: A, nodeUrl: NODE })).entries
    ).toHaveLength(4);
  });

  it("keeps the refusal to that node", async () => {
    await store.putArchiveRefusal(
      "https://testnet.nodes.dusk.network",
      Date.now()
    );
    await expect(
      history.assertArchive("https://testnet.nodes.dusk.network")
    ).rejects.toBeInstanceOf(history.NoArchiveError);
    await expect(
      history.assertArchive("https://my.archive.example")
    ).resolves.toBeUndefined();
  });
});

describe("noteActivityUnavailable", () => {
  it("says once that the archive is unreachable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    history.noteActivityUnavailable(new Error("down"));
    history.noteActivityUnavailable(new Error("still down"));

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("fetchTxDetails", () => {
  it("reads outcomes, errors and fees", async () => {
    fakeArchive();

    const failed =
      "10e446480bd93cd2ae24d221b738ec5cd109951717ca82b092cab0b53f949f00";
    const ok =
      "8e247a33967153b229ce4f45f61e0f14808d8a417c4a4b37eabb269a8eb08e34";
    const details = await history.fetchTxDetails(NODE, [
      failed,
      ok,
      "00".repeat(32),
    ]);

    expect(details.get(failed)).toMatchObject({
      error: "Panic: DRC20Phoenix: invalid proof",
      fee: "200000000",
      success: false,
    });
    expect(details.get(ok)).toMatchObject({
      fee: "1849580",
      success: true,
      timestamp: 1_792_665_841_000,
    });

    // A transaction the node doesn't have gets no details.
    expect(details.has("00".repeat(32))).toBe(false);
  });

  it("reads what a call to the bridge did from its arguments, and looks again at one read before", async () => {
    const { bridge, portal } = bridgeCalls.contracts;
    const args = (/** @type {string} */ name) =>
      bridgeCalls.calls.find((c) => c.name === name)?.args;
    const prove = "c1".repeat(32);
    const deposit = "c2".repeat(32);
    const ok =
      "8e247a33967153b229ce4f45f61e0f14808d8a417c4a4b37eabb269a8eb08e34";
    /** @type {Record<string, any>} */
    const details = fixture.details;
    /**
     * @param {string} contractId
     * @param {string} fnName
     * @param {string | undefined} data
     */
    const tx = (contractId, fnName, data) => ({
      ...details[ok],
      tx: { ...details[ok].tx, callData: { contractId, data, fnName } },
    });

    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", bridge);
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", `0x${portal}`);
    details[prove] = tx(
      portal,
      "proveWithdrawalTransaction",
      args("prove-account")
    );
    details[deposit] = tx(
      bridge,
      "depositETHToWithValue",
      args("deposit-shoot")
    );

    try {
      const node = fakeArchive();
      const read = await history.fetchTxDetails(NODE, [prove, deposit, ok]);

      expect(node.detailQueries()[0].query).toContain(
        "callData { contractId fnName data }"
      );
      expect(read.get(prove)?.bridge).toMatchObject({
        amount: "1008000000000",
        kind: "prove",
      });
      expect(read.get(deposit)?.bridge).toEqual({
        amount: "100000000",
        kind: "deposit",
        to: "0x96BA8D18dBa0a9B933c2e733EA07F47767dc893e",
      });
      expect(read.get(ok)?.bridge).toBeUndefined();

      // A bridge call looked up before is looked up again, once.
      expect(history.needsDetails({ contractId: portal, detailsAt: 1 })).toBe(
        true
      );
      expect(
        history.needsDetails({ bridge: null, contractId: portal, detailsAt: 1 })
      ).toBe(false);
      expect(
        history.needsDetails({ contractId: "ab".repeat(32), detailsAt: 1 })
      ).toBe(false);
      expect(history.needsDetails({ contractId: portal })).toBe(true);
      // A withdrawal's proof or claim read before the history kept its hash,
      // which its claim date is read by, is read again; one with it isn't.
      expect(
        history.needsDetails({
          bridge: { amount: "1", kind: "prove", withdrawal: "01" },
          contractId: portal,
          detailsAt: 1,
        })
      ).toBe(true);
      expect(
        history.needsDetails({
          bridge: { amount: "1", kind: "claim", withdrawal: "01" },
          contractId: portal,
          detailsAt: 1,
        })
      ).toBe(true);
      expect(
        history.needsDetails({
          bridge: {
            amount: "1",
            hash: `0x${"8e".repeat(32)}`,
            kind: "prove",
            withdrawal: "01",
          },
          contractId: portal,
          detailsAt: 1,
        })
      ).toBe(false);
    } finally {
      delete details[prove];
      delete details[deposit];
      vi.unstubAllEnvs();
    }
  });
});

describe("a .dusk name's registration", () => {
  it("is read for the name it registered and what it reveals of its reservation, and one read before is read again, once", async () => {
    const [alice] = REGISTRATIONS;
    const registration = "d1".repeat(32);
    const ok =
      "8e247a33967153b229ce4f45f61e0f14808d8a417c4a4b37eabb269a8eb08e34";
    /** @type {Record<string, any>} */
    const details = fixture.details;

    details[registration] = {
      ...details[ok],
      tx: {
        ...details[ok].tx,
        callData: {
          contractId: alice.contractId,
          data: alice.data,
          fnName: alice.fnName,
        },
      },
    };

    try {
      fakeArchive();

      const read = await history.fetchTxDetails(NODE, [registration, ok]);
      const root = alice.data.slice(-608);

      expect(read.get(registration)?.registeredName).toBe("alice.dusk");
      expect(read.get(registration)?.nameCommit).toStrictEqual({
        commitment: root.slice(82, 146),
        node: root.slice(0, 64),
        secret: root.slice(146, 210),
      });
      expect(read.get(ok)).not.toHaveProperty("registeredName");
      expect(read.get(ok)).not.toHaveProperty("nameCommit");
    } finally {
      delete details[registration];
    }

    const call = { contractId: STORE, detailsAt: 1, fnName: "register" };
    const commit = { commitment: "ab".repeat(32) };

    expect(history.needsDetails(call)).toBe(true);
    expect(history.needsDetails({ ...call, registeredName: null })).toBe(true);
    expect(
      history.needsDetails({ ...call, nameCommit: null, registeredName: null })
    ).toBe(false);
    expect(
      history.needsDetails({
        ...call,
        nameCommit: commit,
        registeredName: "alice.dusk",
      })
    ).toBe(false);
    // A reservation is read again for what it holds, once.
    expect(history.needsDetails({ ...call, fnName: "commit" })).toBe(true);
    expect(
      history.needsDetails({ ...call, fnName: "commit", nameCommit: commit })
    ).toBe(false);
    expect(history.needsDetails({ ...call, fnName: "renew" })).toBe(false);
  });

  it("keeps the name it registered and what it reveals through the store, for the history's rows", async () => {
    const [alice] = REGISTRATIONS;
    const ownerKey = store.activityOwnerKey("testnet", A);
    const hash = "d2".repeat(32);

    await store.commitActivityStep(
      ownerKey,
      [
        {
          blockHeight: 10,
          counterparty: STORE,
          direction: "out",
          hash,
          kind: "contract_call",
          memo: "",
          payer: true,
          value: "10000000000",
        },
      ],
      () => ({
        account: A,
        covered: [[10, 10]],
        finalized: 10,
        genesis: "",
        headAt: 1,
        target: 0,
        updatedAt: 1,
        window: 1,
      })
    );
    await store.patchActivityEntries(
      ownerKey,
      new Map([
        [
          hash,
          {
            contractId: alice.contractId,
            detailsAt: 1,
            fee: "1",
            fnName: "register",
            gasLimit: "1",
            gasPrice: "1",
            gasSpent: "1",
            nameCommit: { commitment: "ab".repeat(32) },
            registeredName: "alice.dusk",
            success: true,
            timestamp: 1,
          },
        ],
      ])
    );

    const [entry] = (await kept(A)).map(history.activityEntry);

    expect(entry.registeredName).toBe("alice.dusk");
    expect(entry.nameCommit).toStrictEqual({ commitment: "ab".repeat(32) });
    expect(history.needsDetails(entry)).toBe(false);
  });
});

describe("historyArchiverUrl", () => {
  it("reads a network's history from the archiver given, else from its node", () => {
    expect(
      history.historyArchiverUrl({
        archiverUrl: "https://my.archive",
        nodeUrl: "https://my.node",
      })
    ).toBe("https://my.archive");
    expect(
      history.historyArchiverUrl({
        archiverUrl: " ",
        nodeUrl: "https://testnet.nodes.dusk.network",
      })
    ).toBe("https://testnet.nodes.dusk.network");
  });
});

describe("a node under a base path", () => {
  it("asks the archive under the node's base path, and keeps its history apart from other paths", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: { ok: true } }))
    );

    vi.stubGlobal("fetch", fetch);

    await history.archiveQuery("https://node.example/rusk/", "query { ok }");

    expect(String(/** @type {any[]} */ (fetch.mock.calls[0])[0])).toBe(
      "https://node.example/rusk/on/graphql/query"
    );
    // A node of a network without a file, as a local one.
    setNodeNetwork(null);

    expect(history.activityNetworkKey("https://node.example/rusk")).toBe(
      "https://node.example/rusk"
    );
    expect(history.activityNetworkKey("https://node.example/rusk/")).toBe(
      history.activityNetworkKey("https://node.example/rusk")
    );
    expect(history.activityNetworkKey("https://node.example/other")).not.toBe(
      history.activityNetworkKey("https://node.example/rusk")
    );
    // Testnet by the chain ID its node gives, whatever node it is.
    setNodeNetwork(networks.testnet);

    expect(history.activityNetworkKey("https://node.example/rusk")).toBe(
      "testnet"
    );
  });
});
