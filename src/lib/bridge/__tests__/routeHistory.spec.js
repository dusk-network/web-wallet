import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { cardRoutes } from "../cardRoutes";
import * as migrations from "../migrationActivity";
import * as follow from "../routeHistory";

/**
 * Stores as small as the follower needs: the history's rows and the wallet.
 */
const mocks = vi.hoisted(() => {
  /** @param {any} value */
  const store = (value) => {
    /** @type {Set<(value: any) => void>} */
    const subscribers = new Set();

    return {
      /** @param {any} next */
      set(next) {
        value = next;
        subscribers.forEach((run) => run(value));
      },
      /** @param {(value: any) => void} run */
      subscribe(run) {
        subscribers.add(run);
        run(value);

        return () => subscribers.delete(run);
      },
    };
  };

  return {
    activity: store({ rows: [] }),
    wallet: store({
      balance: { unshielded: { nonce: 0n, value: 0n } },
      currentProfile: null,
    }),
  };
});

vi.mock("$lib/activity", () => ({
  activityState: { subscribe: mocks.activity.subscribe },
  currentActivity: () => null,
}));

vi.mock("$lib/stores", () => ({
  walletStore: { subscribe: mocks.wallet.subscribe },
}));

const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const OTHER =
  "213qXNJXsQEGigeKJ8jFxuaPb1UV2BiGNykjS3cqRULiaBjQQcGQyEknV7WAhNF5u9hhhFoJcLxbuMWuWhCq3b9jCHDTpvGZaV5HcUU8Z5c4oHbdJ7TQ1NWQJNghYV5JJ9Y";
const BSC =
  /** @type {Extract<import("../cardRoutes").CardRoute, { kind: "migration" }>} */ (
    cardRoutes(networks.mainnet).find(({ id }) => id === "bsc-to-dusk")
  );
const MIGRATION = `0x${"a6".repeat(32)}`;
const NOW = Date.UTC(2026, 9, 29, 16, 30);
const DUSK = 1_000_000_000n;

/**
 * A history row, by default a public transfer received.
 *
 * @param {Record<string, unknown>} fields
 */
const row = (fields) =>
  rowOf({
    amount: String(5n * DUSK),
    blockHeight: 4_700_000,
    direction: "in",
    hash: "bb".repeat(32),
    status: "executed",
    timestamp: NOW,
    ...fields,
  });

/** The migration's payout: from the route's payout account, its hash the memo. */
const payout = row({ counterparty: BSC.payoutAccount ?? "", memo: MIGRATION });

/** @param {bigint} value */
const showBalance = (value, account = ACCOUNT) =>
  mocks.wallet.set({
    balance: { unshielded: { nonce: 0n, value } },
    currentProfile: { account },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setNodeNetwork(networks.mainnet);
  mocks.activity.set({ rows: [] });
  showBalance(10n * DUSK);
  migrations.forgetRouteTransfers();
  migrations.rememberMigration({
    amountLux: String(5n * DUSK),
    createdAt: NOW - 60_000,
    hash: MIGRATION,
    recipient: ACCOUNT,
    routeId: "bsc-to-dusk",
    sender: "0x1111111111111111111111111111111111111111",
  });
  migrations.markMigrationConfirmed(MIGRATION);
});

afterEach(() => {
  vi.useRealTimers();
  setNodeNetwork(null);
  migrations.forgetRouteTransfers();
});

describe("waitsOnHistory", () => {
  /**
   * Whether the history is waited on, with the account's transfers as the
   * history, the migration sent from here and the network give them.
   *
   * @param {{ account?: string, net?: import("@dusk-network/networks").Network | null, now?: number, rows?: ActivityRow[], sent?: import("../migrationActivity").KeptMigration[] }} [state]
   */
  const waits = async ({
    account = ACCOUNT,
    net = networks.mainnet,
    now = NOW,
    rows = [],
    sent = [
      {
        amountLux: String(5n * DUSK),
        confirmed: true,
        createdAt: NOW - 60_000,
        hash: MIGRATION,
        recipient: ACCOUNT,
        routeId: "bsc-to-dusk",
        sender: "0x1111111111111111111111111111111111111111",
      },
    ],
  } = {}) =>
    follow.waitsOnHistory({
      now,
      rows,
      transfers: await migrations.routeTransfersOf({
        account,
        known: {},
        net,
        rows,
        sent,
      }),
    });

  it("is so while a migration sent from here in the last day isn't paid", async () => {
    expect(await waits()).toBe(true);
    expect(await waits({ rows: [payout] })).toBe(false);
    expect(await waits({ now: NOW + follow.FOLLOW_FOR_MS })).toBe(false);
    expect(await waits({ account: OTHER })).toBe(false);
    expect(await waits({ net: null })).toBe(false);
  });

  it("is so while a transfer out isn't in a block yet", async () => {
    const out = row({
      direction: "out",
      memo: "0x1111111111111111111111111111111111111111",
      source: "local",
      status: "submitted",
      to: BSC.payoutAccount ?? "",
    });

    expect(await waits({ rows: [out], sent: [] })).toBe(true);
    expect(
      await waits({ rows: [{ ...out, status: "executed" }], sent: [] })
    ).toBe(false);
  });
});

describe("followRouteHistory", () => {
  it("reads the history while a migration waits for its payout, and stops once it's paid", async () => {
    const read = vi.fn();
    const stop = follow.followRouteHistory({ read });

    await vi.advanceTimersByTimeAsync(follow.FOLLOW_MS);
    expect(read).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(follow.FOLLOW_MS);
    expect(read).toHaveBeenCalledTimes(2);

    // Paid: nothing more is read.
    mocks.activity.set({ rows: [payout] });
    await vi.advanceTimersByTimeAsync(10 * follow.FOLLOW_MS);
    expect(read).toHaveBeenCalledTimes(2);

    stop();
  });

  it("reads the balance again at once when the history finds a public transaction in a newer block, as a send does", () => {
    migrations.forgetRouteTransfers();
    mocks.activity.set({ loaded: true, rows: [row({ blockHeight: 100 })] });

    const refreshBalance = vi.fn();
    const stop = follow.followRouteHistory({ read: vi.fn(), refreshBalance });

    // What the history starts with is in the balance already.
    expect(refreshBalance).not.toHaveBeenCalled();

    // A migration's payout, found by a read.
    mocks.activity.set({
      loaded: true,
      rows: [{ ...payout, blockHeight: 101 }, row({ blockHeight: 100 })],
    });
    expect(refreshBalance).toHaveBeenCalledOnce();

    // Older ones shown later, a shielded one, and one of the wallet's own
    // not in a block yet: no.
    mocks.activity.set({
      loaded: true,
      rows: [
        row({ blockHeight: undefined, hash: "cc".repeat(32), source: "local" }),
        row({ blockHeight: 300, hash: "dd".repeat(32), source: "shielded" }),
        { ...payout, blockHeight: 101 },
        row({ blockHeight: 100 }),
        row({ blockHeight: 50, hash: "ee".repeat(32) }),
      ],
    });
    expect(refreshBalance).toHaveBeenCalledOnce();

    // Another history, as after a lock or for another profile, starts over.
    mocks.activity.set({ loaded: false, rows: [] });
    mocks.activity.set({ loaded: true, rows: [row({ blockHeight: 400 })] });
    expect(refreshBalance).toHaveBeenCalledOnce();

    stop();
  });

  it("reads nothing while nothing waits, but for a change in the public balance", async () => {
    migrations.forgetRouteTransfers();

    const read = vi.fn();
    const stop = follow.followRouteHistory({ read });

    await vi.advanceTimersByTimeAsync(10 * follow.FOLLOW_MS);
    expect(read).not.toHaveBeenCalled();

    // A payout of a migration sent elsewhere, as the wallet's sync finds it.
    showBalance(15n * DUSK);
    expect(read).toHaveBeenCalledOnce();

    // Another profile's balance is that profile's own.
    showBalance(3n * DUSK, OTHER);
    expect(read).toHaveBeenCalledOnce();

    stop();
    showBalance(4n * DUSK, OTHER);
    expect(read).toHaveBeenCalledOnce();
  });
});
