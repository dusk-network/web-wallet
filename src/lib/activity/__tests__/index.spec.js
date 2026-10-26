import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import fixture from "./fixtures/activity-testnet.json";
import { fakeArchive } from "./fixtures/fakeArchive";
import {
  activityFor,
  activityState,
  asTransactions,
  currentActivity,
  stopActivity,
} from "..";

const [A, B] = Object.keys(fixture.accounts);
const NODE = fixture.nodeUrl;

/** @param {string} account */
const optionsFor = (account) => ({
  account,
  namesNetwork: "testnet",
  nodeUrl: NODE,
  profileIndex: 0,
});

afterEach(() => {
  stopActivity();
  vi.unstubAllGlobals();
});

describe("activityFor", () => {
  it("keeps one history session, for the account shown, and its state", async () => {
    fakeArchive();

    const first = activityFor(optionsFor(A));

    expect(activityFor(optionsFor(A))).toBe(first);
    await first.start();
    expect(get(activityState).rows.length).toBeGreaterThan(0);

    const listener = vi.fn();

    first.subscribe(listener);
    listener.mockClear();

    const second = activityFor(optionsFor(B));

    expect(second).not.toBe(first);
    expect(currentActivity()).toBe(second);

    // The first one stopped: it tells nobody anything any more.
    await first.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it("forgets the session and its rows when stopped, as for a lock", async () => {
    fakeArchive();
    await activityFor(optionsFor(A)).start();

    stopActivity();

    expect(currentActivity()).toBeNull();
    expect(get(activityState)).toMatchObject({ loaded: false, rows: [] });
  });
});

describe("asTransactions", () => {
  it("gives the transactions on chain with their amounts and fees in DUSK, as they changed the balance", () => {
    /** @type {ActivityRow[]} */
    const rows = [
      {
        amount: "5000000000",
        direction: "out",
        hash: "aa".repeat(32),
        kind: "transfer",
        source: "local",
        status: "submitted",
      },
      {
        amount: "1100000000000",
        blockHeight: 4655845,
        direction: "in",
        hash: "bb".repeat(32),
        kind: "transfer",
        source: "archive",
        status: "executed",
      },
      {
        amount: "100000000000",
        blockHeight: 4658012,
        direction: "out",
        feePaid: "2897558",
        hash: "cc".repeat(32),
        kind: "contract_call",
        source: "archive",
        status: "executed",
      },
      {
        amount: "200000000000",
        blockHeight: 4658100,
        direction: "out",
        feePaid: "3700000",
        hash: "dd".repeat(32),
        kind: "transfer",
        source: "archive",
        status: "failed",
      },
    ];

    expect(asTransactions(rows)).toEqual([
      {
        amount: 1100,
        // eslint-disable-next-line camelcase
        block_height: 4655845,
        direction: "In",
        fee: 0,
        id: "bb".repeat(32),
        // eslint-disable-next-line camelcase
        tx_type: "TRANSFER",
      },
      {
        amount: -100,
        // eslint-disable-next-line camelcase
        block_height: 4658012,
        direction: "Out",
        fee: 0.002897558,
        id: "cc".repeat(32),
        // eslint-disable-next-line camelcase
        tx_type: "CONTRACT_CALL",
      },
      {
        // Nothing left the account: only the fee.
        amount: 0,
        // eslint-disable-next-line camelcase
        block_height: 4658100,
        direction: "Out",
        fee: 0.0037,
        id: "dd".repeat(32),
        // eslint-disable-next-line camelcase
        tx_type: "TRANSFER",
      },
    ]);
  });
});
