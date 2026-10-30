import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "./fixtures/activity-testnet.json";
import { fakeArchive } from "./fixtures/fakeArchive";

const mocks = vi.hoisted(() => ({
  lookupCounterpartyNames: vi.fn(async () => new Map()),
}));

vi.mock("../counterpartyNames", async (importOriginal) => ({
  .../** @type {typeof import("../counterpartyNames")} */ (
    await importOriginal()
  ),
  lookupCounterpartyNames: mocks.lookupCounterpartyNames,
}));

const [A, B] = Object.keys(fixture.accounts);
const NODE = fixture.nodeUrl;
const FINALIZED = Number(fixture.head.last_finalized_block[0]);

/** @type {Record<string, { receiver: any[], sender: any[] }>} */
const accounts = /** @type {any} */ (fixture.accounts);

/** @param {number} height */
const entryOfA = (height) =>
  [...accounts[A].sender, ...accounts[A].receiver].find(
    (e) => e.block_height === height
  );

/** @type {import("@dusk-network/app-core/shielded").ShieldedEntry} */
const shieldedEntry = {
  blockHeight: 3861643,
  direction: "in",
  fee: null,
  hash: "ab".repeat(32),
  kind: "shield",
  success: true,
  timestamp: 1_784_723_688_000,
  value: "2000000000",
};

/** @type {typeof import("../activitySession")} */
let sessions;

/** @type {typeof import("../activityStore")} */
let store;

/** @type {import("../activitySession").ActivitySession[]} */
const started = [];

/** A's history, synced by another run: on an earlier visit, or in another tab. */
async function syncA() {
  const { publicHistory } = await import("../activityHistory");
  const epoch = await store.getActivityEpoch();

  await publicHistory({ account: A, epoch, nodeUrl: NODE }).sync();
}

/** @param {Partial<import("../activitySession").ActivitySessionOptions>} [options] */
function sessionFor(options = {}) {
  const session = new sessions.ActivitySession({
    account: A,
    namesNetwork: "testnet",
    nodeUrl: NODE,
    profileIndex: 0,
    ...options,
  });

  started.push(session);

  return session;
}

beforeEach(async () => {
  vi.resetModules();
  store = await import("../activityStore");
  await store.activityDatabase.delete({ disableAutoOpen: false });
  sessions = await import("../activitySession");
  // On a testnet node: the recordings' network.
  (await import("$lib/stores/nodeNetwork")).setNodeNetwork(
    (await import("@dusk-network/networks")).networks.testnet
  );
  mocks.lookupCounterpartyNames.mockReset();
  mocks.lookupCounterpartyNames.mockResolvedValue(new Map());
});

afterEach(() => {
  started.splice(0).forEach((session) => session.stop());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ActivitySession", () => {
  it("paints the kept history at once, then syncs, names the counterparties and adds the shielded history", async () => {
    const node = fakeArchive({ finalized: 4_656_000 });
    const sender = entryOfA(4657992).events[0].data.sender;
    const shielded = vi.fn(async () => ({ entries: [shieldedEntry] }));

    // Kept from an earlier visit: the transfer at 4655845.
    await syncA();
    node.finalized = FINALIZED;
    mocks.lookupCounterpartyNames.mockResolvedValue(
      new Map([[sender, "faucet.dusk"]])
    );

    const session = sessionFor({ shielded });

    /** @type {import("../activitySession").ActivityState[]} */
    const states = [];

    session.subscribe((state) => states.push(state));
    await session.start();
    await vi.waitFor(() =>
      expect(session.state.rows.at(-1)?.privacy).toBe("shielded")
    );

    expect(
      states.find((state) => state.loaded)?.rows.map((r) => r.blockHeight)
    ).toEqual([4655845]);
    expect(
      session.state.rows.map((r) => [r.blockHeight, r.source, r.status])
    ).toEqual([
      [4658012, "public", "executed"],
      [4658000, "public", "executed"],
      [4657992, "public", "executed"],
      [4655845, "public", "executed"],
      [3861643, "shielded", "executed"],
    ]);
    expect(
      session.state.rows.find((r) => r.blockHeight === 4657992)
    ).toMatchObject({ counterparty: sender, counterpartyName: "faucet.dusk" });
    expect(mocks.lookupCounterpartyNames).toHaveBeenCalledWith(
      expect.arrayContaining([sender]),
      { network: "testnet", nodeUrl: NODE }
    );
    expect(session.state).toMatchObject({
      complete: true,
      error: null,
      syncing: false,
    });
  });

  it("asks for a shielded history it couldn't have yet again once the notes are synced, or a minute later", async () => {
    fakeArchive();

    const shielded = vi
      .fn()
      .mockResolvedValueOnce({ entries: [], pending: true })
      .mockResolvedValueOnce({ entries: [], pending: true })
      .mockResolvedValue({ entries: [shieldedEntry] });
    const session = sessionFor({ shielded });

    await session.start();
    await vi.waitFor(() => expect(shielded).toHaveBeenCalledTimes(1));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      // The wallet's sync completes: asked again at once.
      session.notesSynced();
      await vi.waitFor(() => expect(shielded).toHaveBeenCalledTimes(2));

      // Still pending: asked again a minute later, with no run or sync.
      await vi.advanceTimersByTimeAsync(sessions.SHIELDED_RETRY_MS);
      await vi.waitFor(() => expect(shielded).toHaveBeenCalledTimes(3));
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() =>
      expect(session.state.rows.at(-1)?.privacy).toBe("shielded")
    );

    // Had: asked again only when the notes synced again, for new ones.
    await session.refresh();

    expect(shielded).toHaveBeenCalledTimes(3);

    session.notesSynced();
    await vi.waitFor(() => expect(shielded).toHaveBeenCalledTimes(4));
  });

  it("keeps a counterparty's kept name when checking it fails, and checks it again next run", async () => {
    fakeArchive();

    const sender = entryOfA(4657992).events[0].data.sender;

    // Kept from an earlier visit: the history, and the sender's name.
    await syncA();
    await store.putCounterpartyNames(
      "testnet",
      new Map([[sender, "faucet.dusk"]]),
      { epoch: await store.getActivityEpoch() }
    );

    // The lens is out of reach: the lookup leaves the account out.
    mocks.lookupCounterpartyNames.mockResolvedValue(new Map());

    const session = sessionFor();

    await session.start();

    expect(
      session.state.rows.find((r) => r.blockHeight === 4657992)
    ).toMatchObject({ counterpartyName: "faucet.dusk" });

    const asked = () =>
      mocks.lookupCounterpartyNames.mock.calls.filter((call) =>
        /** @type {string[][]} */ (/** @type {unknown} */ (call))[0].includes(
          sender
        )
      ).length;

    expect(asked()).toBe(1);

    await session.refresh();

    expect(asked()).toBe(2);
  });

  it("shows the wallet's own send at once, and the chain's row instead once the archive has it", async () => {
    const node = fakeArchive({ finalized: 4_658_000 });
    const hash = entryOfA(4658012).origin;
    const session = sessionFor();

    await session.start();
    await session.recordSent({
      amount: "100000000000",
      hash,
      kind: "contract_call",
      privacy: "public",
    });

    expect(session.state.rows[0]).toMatchObject({
      hash,
      source: "sent",
      status: "pending",
    });

    node.finalized = FINALIZED;
    await session.refresh();

    expect(session.state.rows[0]).toMatchObject({
      blockHeight: 4658012,
      hash,
      source: "public",
      status: "executed",
    });
    expect(
      await store.listLocalTransactions(store.activityOwnerKey("testnet", A))
    ).toEqual([]);
  });

  it("puts a call to the bridge set for a local deployment under Bridge, on a network whose file has no DuskEVM", async () => {
    const local = "cd".repeat(32);
    const hash = "c2".repeat(32);

    (await import("$lib/stores/nodeNetwork")).setNodeNetwork(
      (await import("@dusk-network/networks")).networks.devnet
    );
    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", local);
    fakeArchive({ finalized: 4_656_000 });
    const session = sessionFor();

    await session.start();
    await session.recordSent({
      amount: "100000000",
      contractId: local,
      fnName: "depositETHToWithValue",
      hash,
      kind: "contract_call",
      privacy: "public",
    });

    expect(session.state.rows.find((row) => row.hash === hash)).toMatchObject({
      category: "bridge",
    });
  });

  it("keeps the name typed for a send with the chain's row, once the archive has it", async () => {
    const node = fakeArchive({ finalized: 4_658_000 });
    const hash = entryOfA(4658012).origin;
    const session = sessionFor();

    await session.start();
    await session.recordSent({
      amount: "100000000000",
      hash,
      kind: "contract_call",
      privacy: "public",
      toName: "alice.dusk",
    });
    node.finalized = FINALIZED;
    await session.refresh();

    expect(session.state.rows[0]).toMatchObject({
      hash,
      source: "public",
      status: "executed",
      toName: "alice.dusk",
    });
    expect(
      await store.listLocalTransactions(store.activityOwnerKey("testnet", A))
    ).toEqual([expect.objectContaining({ hash, settled: true })]);
  });

  it("settles a shielded send against the shielded history, keeping its memo, and stops waiting for the archive", async () => {
    fakeArchive();

    const hash = shieldedEntry.hash;
    const shielded = vi
      .fn()
      .mockResolvedValueOnce({ entries: [] })
      .mockResolvedValue({
        entries: [{ ...shieldedEntry, direction: "out", kind: "transfer" }],
      });
    const session = sessionFor({ shielded });

    await session.start();
    await vi.waitFor(() => expect(shielded).toHaveBeenCalledTimes(1));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      await session.recordSent({
        amount: "2000000000",
        hash,
        kind: "transfer",
        memo: "Invoice 42",
        privacy: "shielded",
        to: B,
      });

      // The notes synced after the send: the shielded history has it, the
      // record settles, and no refresh is asked for any more.
      session.notesSynced();
      await vi.waitFor(() => expect(shielded).toHaveBeenCalledTimes(2));
      await vi.waitFor(async () =>
        expect(
          await store.listLocalTransactions(
            store.activityOwnerKey("testnet", A)
          )
        ).toEqual([expect.objectContaining({ hash, settled: true })])
      );

      // The refresh the send asked for runs, and asks for no other.
      await vi.advanceTimersByTimeAsync(sessions.AFTER_TX_MS);
      await vi.waitFor(() => expect(session.state.syncing).toBe(false));

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    expect(session.state.rows.find((r) => r.hash === hash)).toMatchObject({
      memo: "Invoice 42",
      source: "shielded",
      status: "executed",
    });
  });

  it("tells nobody anything once stopped", async () => {
    fakeArchive();

    const listener = vi.fn();
    const session = sessionFor();

    session.subscribe(listener);
    listener.mockClear();

    const run = session.start();

    session.stop();
    await run;

    expect(listener).not.toHaveBeenCalled();
  });

  it("says nothing of a run another one overtook, and shows the history as that one left it", async () => {
    const node = fakeArchive();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const atWindow = Promise.withResolvers();
    const held = Promise.withResolvers();
    let holding = true;

    // The session's run waits at its first window...
    node.before = async (query) => {
      if (holding && query.includes("toBlock")) {
        holding = false;
        atWindow.resolve(undefined);
        await held.promise;
      }
    };

    const session = sessionFor();
    const run = session.start();

    await atWindow.promise;

    // ... while another run finds the node on another chain, and starts the
    // history over there.
    node.genesis = "ff".repeat(32);
    await syncA();
    held.resolve(undefined);
    await run;

    expect(session.state).toMatchObject({ error: null, syncing: false });
    expect(warn).not.toHaveBeenCalled();
    expect(session.state.rows.map((r) => r.blockHeight)).toEqual([
      4658012, 4658000, 4657992, 4655845,
    ]);
    expect(
      await store.getActivityMeta(store.activityOwnerKey("testnet", A))
    ).toMatchObject({ genesis: "ff".repeat(32) });
  });

  it("shows more below a block the first page showed whole, however big", async () => {
    // Derived: 10 transfers on top, each in its own block, then 100 in one
    // block, then 30 older ones, oldest first as the archive lists them.
    const sample = accounts[A].receiver[0];
    /** @param {number} height @param {number} n */
    const at = (height, n) => ({
      ...sample,
      ["block_height"]: height,
      origin: n.toString(16).padStart(64, "0"),
    });
    const top = FINALIZED - 100;
    const receiver = [
      ...Array.from({ length: 30 }, (_, i) => at(top - 59 + i, 300 + i)),
      ...Array.from({ length: 100 }, (_, i) => at(top - 20, 100 + i)),
      ...Array.from({ length: 10 }, (_, i) => at(top - 9 + i, 1 + i)),
    ];

    fakeArchive({ accounts: { [A]: { receiver, sender: [] } } });

    // A session syncs once a start: enough of them to keep the whole history.
    let session = sessionFor();

    await session.start();
    for (let i = 0; i < 5 && !session.state.complete; i += 1) {
      session.stop();
      session = sessionFor();
      await session.start();
    }

    // The first page: the 10, then the 100 of the block it cuts through.
    expect(session.state.complete).toBe(true);
    expect(session.state.rows).toHaveLength(110);

    await session.showMore();

    expect(session.state.rows).toHaveLength(140);
    // Several syncs of a 140-entry history: more than the default 5 s on a
    // busy CI runner.
  }, 30_000);

  it("keeps the archive's error for the state and still shows what it kept", async () => {
    const node = fakeArchive({ finalized: 4_656_000 });

    await sessionFor().start();
    node.down = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const session = sessionFor();

    await session.start();

    expect(session.state).toMatchObject({
      error: "fetch failed",
      loaded: true,
    });
    expect(session.state.rows.map((r) => r.blockHeight)).toEqual([4655845]);
  });
});
