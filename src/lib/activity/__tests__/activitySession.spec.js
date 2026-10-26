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

/** @type {ActivityRow} */
const shieldedRow = {
  amount: "2000000000",
  blockHeight: 3861643,
  direction: "in",
  hash: "ab".repeat(32),
  kind: "shield",
  privacy: "shielded",
  source: "shielded",
  status: "executed",
  timestamp: 1_784_723_688_000,
};

/** @type {typeof import("../activitySession")} */
let sessions;

/** @type {typeof import("../activityStore")} */
let store;

/** @type {import("../activitySession").ActivitySession[]} */
const started = [];

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
  mocks.lookupCounterpartyNames.mockReset();
  mocks.lookupCounterpartyNames.mockResolvedValue(new Map());
});

afterEach(() => {
  started.splice(0).forEach((session) => session.stop());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ActivitySession", () => {
  it("paints the kept history at once, then syncs, names the counterparties and adds the shielded history", async () => {
    const node = fakeArchive({ finalized: 4_656_000 });
    const sender = entryOfA(4657992).events[0].data.sender;
    const shielded = vi.fn(async () => ({ entries: [shieldedRow] }));

    // Kept from an earlier visit: the transfer at 4655845.
    await (
      await import("../activityHistory")
    ).syncActivity({ account: A, nodeUrl: NODE });
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
      [4658012, "archive", "executed"],
      [4658000, "archive", "executed"],
      [4657992, "archive", "executed"],
      [4655845, "archive", "executed"],
      [3861643, "shielded", "executed"],
    ]);
    expect(
      session.state.rows.find((r) => r.blockHeight === 4657992)
    ).toMatchObject({ counterpartyName: "faucet.dusk", from: sender });
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
      .mockResolvedValue({ entries: [shieldedRow] });
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
      source: "local",
      status: "submitted",
    });

    node.finalized = FINALIZED;
    await session.refresh();

    expect(session.state.rows[0]).toMatchObject({
      blockHeight: 4658012,
      hash,
      source: "archive",
      status: "executed",
    });
    expect(
      await store.listLocalTransactions(store.activityOwnerKey("testnet", A))
    ).toEqual([]);
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
      source: "both",
      status: "executed",
      toName: "alice.dusk",
    });
    expect(
      await store.listLocalTransactions(store.activityOwnerKey("testnet", A))
    ).toEqual([expect.objectContaining({ hash, settled: true })]);
  });

  it("settles a shielded send against the shielded history, keeping its memo, and stops waiting for the archive", async () => {
    fakeArchive();

    const hash = shieldedRow.hash;
    const shielded = vi
      .fn()
      .mockResolvedValueOnce({ entries: [] })
      .mockResolvedValue({
        entries: [{ ...shieldedRow, direction: "out", kind: "transfer" }],
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
      source: "both",
      status: "executed",
    });
  });

  it("says the outcome of a send the archive never had is unknown, after a while", async () => {
    fakeArchive();

    const session = sessionFor();
    const hash = "ee".repeat(32);

    await session.start();
    await session.recordSent({
      amount: "1000000000",
      hash,
      kind: "transfer",
      privacy: "public",
      to: B,
    });

    expect(session.rows.find((r) => r.hash === hash)?.status).toBe("submitted");

    vi.spyOn(Date, "now").mockReturnValue(
      Date.now() + sessions.LOCAL_PENDING_MS
    );

    expect(session.rows.find((r) => r.hash === hash)?.status).toBe("unknown");
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
