import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityRows } from "@dusk-network/app-core/activity";
import { networks } from "@dusk-network/networks";
import { depositCall } from "@dusk-network/networks/duskevm";

import fixture from "./fixtures/activity-testnet.json";
import { fakeArchive } from "./fixtures/fakeArchive";
import { calls as REGISTRATIONS } from "./fixtures/registrations-testnet.json";

import { describeRow } from "../present";

/*
 * Recorded on Testnet: A registered a .dusk name and received two transfers;
 * B has years of transfers, contract calls, a shield, stake rewards and an
 * unstake. The sync itself is @dusk-network/app-core's, tested there: these
 * are what the wallet adds to it.
 */
const [A, B] = Object.keys(fixture.accounts);
const NODE = fixture.nodeUrl;

/** @type {Record<string, { receiver: any[], sender: any[] }>} */
const accounts = /** @type {any} */ (fixture.accounts);

/** @type {typeof import("../activityHistory")} */
let history;

/** @type {typeof import("../activityStore")} */
let store;

beforeEach(async () => {
  // A new database per test, and fresh modules, on a testnet node: the
  // recordings' network.
  vi.resetModules();
  store = await import("../activityStore");
  await store.activityDatabase.delete({ disableAutoOpen: false });
  history = await import("../activityHistory");
  (await import("$lib/stores/nodeNetwork")).setNodeNetwork(networks.testnet);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * An account's history on the node, its writes tied to the store's epoch now.
 *
 * @param {string} account
 */
const historyOf = async (account) =>
  history.publicHistory({
    account,
    epoch: await store.getActivityEpoch(),
    nodeUrl: NODE,
  });

/** @param {string} account */
const sync = async (account) => (await historyOf(account)).sync();

/** @param {string} account */
const kept = (account) =>
  store.listActivityEntries(store.activityOwnerKey("testnet", account), {
    limit: 10_000,
  });

/**
 * The kept history's rows, as History shows them.
 *
 * @param {string} account
 */
async function rowsOf(account) {
  const { entries } = await (await historyOf(account)).read();

  return activityRows({ nameCall: history.nameFacts, public: entries });
}

describe("a .dusk name's reservation and registration", () => {
  /** A node that gives the two calls' arguments with their details. */
  function withCallArgs() {
    const details = structuredClone(fixture.details);

    for (const { data, hash } of REGISTRATIONS) {
      /** @type {Record<string, any>} */ (details)[hash].tx.callData.data =
        data;
    }

    return fakeArchive({ details });
  }

  /** @param {string} account */
  async function titles(account) {
    return (await rowsOf(account)).map(
      (row) => describeRow(row, { locale: "en" }).title
    );
  }

  it("say which name they were for, the reservation once the account that sent it registered the name", async () => {
    withCallArgs();

    // The registration paid the name's contract: it is read with the first
    // details. The reservation paid nothing: it is read once its contract
    // is known, with the next.
    await (await historyOf(A)).sync({ maxDetailRequests: 1 });

    expect((await titles(A)).slice(0, 2)).toStrictEqual([
      "Registered shpongle.dusk",
      "Name reservation (step 1 of 2)",
    ]);

    await sync(A);

    expect((await titles(A)).slice(0, 2)).toStrictEqual([
      "Registered shpongle.dusk",
      "Reserved shpongle.dusk",
    ]);
  });

  it("are read again, once, when they were read before the history checked them", async () => {
    const node = withCallArgs();

    await sync(A);

    // As a wallet that read them before kept them: without what they hold.
    await store.patchActivityEntries(
      store.activityOwnerKey("testnet", A),
      new Map(
        REGISTRATIONS.map(({ hash }) => [
          hash,
          /** @type {any} */ ({ nameCommit: null, registeredName: undefined }),
        ])
      )
    );

    const asked = node.detailQueries().length;

    await sync(A);
    await sync(A);

    expect(node.detailQueries()).toHaveLength(asked + 1);
    expect((await titles(A)).slice(0, 2)).toStrictEqual([
      "Registered shpongle.dusk",
      "Reserved shpongle.dusk",
    ]);
  });
});

describe("a deposit to the bridge set for a local deployment", () => {
  it("reads as the deposit it is, as the wallet sends deposits there", async () => {
    const local = "cd".repeat(32);
    const to = "0x3E5B8223e638CB414BEF8CF95393460cA1C3a11d";
    const call = /** @type {NonNullable<ReturnType<typeof depositCall>>} */ (
      depositCall(networks.testnet, { amountLux: 100_000_000n, to })
    );
    // Derived from A's registration: the same deposit, to that bridge.
    const register = REGISTRATIONS[1].hash;
    const entry = structuredClone(
      accounts[A].sender.find((e) => e.origin === register)
    );
    /** @type {Record<string, any>} */
    const details = fixture.details;

    entry.origin = "c2".repeat(32);
    entry.events[0].data.receiver = local;
    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", local);
    fakeArchive({
      accounts: { [A]: { receiver: [], sender: [entry] } },
      details: {
        [entry.origin]: {
          ...details[register],
          tx: {
            ...details[register].tx,
            callData: {
              contractId: local,
              data: Array.from(call.fnArgs, (b) =>
                b.toString(16).padStart(2, "0")
              ).join(""),
              fnName: call.fnName,
            },
          },
        },
      },
    });

    await sync(A);

    expect((await rowsOf(A))[0].bridge).toMatchObject({
      amount: 100_000_000n,
      step: "deposit",
      to,
    });
  });
});

describe("another chain under the node", () => {
  it("starts the history over, forgetting all this browser kept of the old chain", async () => {
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

    expect((await kept(A)).map((r) => r.blockHeight)).toEqual([4655845]);
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
});

describe("a node without the archive", () => {
  it("is asked nothing for an hour after its first refusal, as this browser keeps it, then again", async () => {
    const node = fakeArchive();
    const now = vi.spyOn(Date, "now");

    node.archive = false;
    now.mockReturnValue(1_000_000_000);
    await expect(sync(A)).rejects.toMatchObject({ name: "NoArchiveError" });

    const asked = node.log.length;

    // Another visit, with nothing of the last one but what this browser kept.
    await expect(sync(A)).rejects.toMatchObject({ name: "NoArchiveError" });
    expect(node.log).toHaveLength(asked);

    // An hour on, it is asked again: now with the archive.
    now.mockReturnValue(1_000_000_000 + 60 * 60_000);
    node.archive = true;
    await sync(A);
    expect(await kept(A)).toHaveLength(4);
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

describe("a node under a base path", () => {
  it("asks the archive under the node's base path, and keeps its history apart from other paths", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: { ok: true } }))
    );

    vi.stubGlobal("fetch", fetch);

    await history.archiveAt("https://node.example/rusk/").query("query { ok }");

    expect(String(/** @type {any[]} */ (fetch.mock.calls[0])[0])).toBe(
      "https://node.example/rusk/on/graphql/query"
    );

    // A node of a network without a file, as a local one.
    (await import("$lib/stores/nodeNetwork")).setNodeNetwork(null);

    expect(history.activityNetworkKey("https://node.example/rusk")).toBe(
      "https://node.example/rusk"
    );
    expect(history.activityNetworkKey("https://node.example/rusk/")).toBe(
      history.activityNetworkKey("https://node.example/rusk")
    );
    expect(history.activityNetworkKey("https://node.example/other")).not.toBe(
      history.activityNetworkKey("https://node.example/rusk")
    );
  });
});
