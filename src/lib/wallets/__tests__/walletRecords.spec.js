import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const APP = CONFIG.LOCAL_STORAGE_APP_KEY;
const KEY = "k";
const MIGRATIONS = `${APP}-migrations:${KEY}`;
const ARRIVALS = `${APP}-transfer-arrivals:${KEY}`;
const DEPOSITS = `dusk-evm:deposit-activity:v1:${KEY}`;
const INCARNATION = `${APP}-incarnation:${KEY}`;
const DEPOSIT = "ab".repeat(32);

/** @param {number} n */
const hashOf = (n) => `0x${n.toString(16).padStart(64, "0")}`;

/** @param {number} n */
const migration = (n) => ({
  amountLux: "1",
  createdAt: n,
  hash: hashOf(n),
  recipient: "r",
  routeId: "bsc-to-dusk",
  sender: "s",
});

/** @param {{ hash: string }[]} items */
const hashesOf = (items) => items.map(({ hash }) => hash).toSorted();

/** @returns {ReturnType<typeof migration>[]} */
const stored = () => JSON.parse(localStorage.getItem(MIGRATIONS) ?? "[]");

const full = () => {
  throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
};

/** Storage refusing the next write, as a full one does. */
const refuseOnce = () =>
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(full);

/**
 * Tells the tabs of a write, as the browser tells every tab but the one
 * that wrote: that one's shows what it wrote already.
 *
 * @param {string} key
 */
const tellTabs = (key) =>
  window.dispatchEvent(new StorageEvent("storage", { key }));

/** A tab, its own memory, the same storage: it unlocks the wallet. */
async function loadTab() {
  vi.resetModules();

  const names = await import("../dataNames");
  const deposits = await import("$lib/bridge/depositActivityStorage");
  const migrations = await import("$lib/bridge/migrationActivity");

  const unlock = async () => {
    await names.keepIncarnation(KEY);
    names.useWalletDataSuffix(`:${KEY}`, KEY);
    deposits.hydrateDepositActivity();
    migrations.hydrateMigrations();
  };

  return { ...migrations, deposits, names, unlock };
}

/** A tab with the wallet open. */
async function openTab() {
  const tab = await loadTab();

  await tab.unlock();

  return tab;
}

describe("A wallet's records, open in two tabs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the record each tab adds, in storage and on both screens", async () => {
    const a = await openTab();
    const b = await openTab();
    const both = [hashOf(1), hashOf(2)];

    a.rememberMigration(migration(1));
    tellTabs(MIGRATIONS);
    b.rememberMigration(migration(2));
    tellTabs(MIGRATIONS);

    expect(hashesOf(stored())).toEqual(both);
    expect(hashesOf(get(a.keptMigrations))).toEqual(both);
    expect(hashesOf(get(b.keptMigrations))).toEqual(both);
  });

  it("keeps another tab's change to a record this one didn't change, as this one writes", async () => {
    const a = await openTab();

    a.rememberMigration(migration(1));

    const b = await openTab();

    b.markMigrationConfirmed(hashOf(1));
    // Before this tab hears of it.
    a.rememberMigration(migration(2));

    expect(stored()).toContainEqual({ ...migration(1), confirmed: true });
  });

  it("still shows a change storage refused as another tab's write shows, and keeps it with the next write", async () => {
    const a = await openTab();
    const b = await openTab();

    refuseOnce();
    a.rememberMigration(migration(1));
    b.rememberMigration(migration(2));
    tellTabs(MIGRATIONS);

    expect(hashesOf(get(a.keptMigrations))).toEqual([hashOf(1), hashOf(2)]);

    a.markMigrationConfirmed(hashOf(2));

    expect(hashesOf(stored())).toEqual([hashOf(1), hashOf(2)]);
    expect(stored()).toContainEqual({ ...migration(2), confirmed: true });
  });

  it("does the same for records kept by key", async () => {
    const a = await openTab();
    const b = await openTab();

    refuseOnce();
    a.keepArrival("x", { payout: "p" });
    b.keepArrival("y", { payout: "q" });
    tellTabs(ARRIVALS);

    expect(get(a.transferArrivals)).toEqual({
      x: { payout: "p" },
      y: { payout: "q" },
    });
  });

  it("keeps out of what it shows a record its refused write dropped, as another tab's write shows", async () => {
    localStorage.setItem(
      MIGRATIONS,
      JSON.stringify(Array.from({ length: 50 }, (_, i) => migration(50 - i)))
    );

    const a = await openTab();
    const b = await openTab();

    refuseOnce();
    // The 51st: the oldest goes.
    a.rememberMigration(migration(51));
    b.markMigrationConfirmed(hashOf(2));
    tellTabs(MIGRATIONS);

    const shown = get(a.keptMigrations);

    expect(shown).toHaveLength(50);
    expect(hashesOf(shown)).not.toContain(hashOf(1));
    expect(shown).toContainEqual({ ...migration(2), confirmed: true });
  });
  it("ends two tabs' first unlocks at once of a wallet from before with one incarnation, keeping both tabs' records", async () => {
    const holding = Promise.withResolvers();
    const go = Promise.withResolvers();
    // The other tab's unlock, begun first: it found none, and writes its own
    // as this tab unlocks.
    const theirs = navigator.locks.request(INCARNATION, async () => {
      const none = localStorage.getItem(INCARNATION) === null;

      holding.resolve(undefined);
      await go.promise;

      if (none) {
        localStorage.setItem(INCARNATION, "theirs");
      }
    });

    await holding.promise;

    const a = await loadTab();
    let done = false;
    const unlocking = a.unlock().then(() => {
      done = true;
    });

    // This tab's unlock goes as far as it can: done, or waiting its turn.
    await vi.waitUntil(
      async () => done || (await navigator.locks.query()).pending?.length
    );
    go.resolve(undefined);
    await theirs;
    await unlocking;

    const b = await openTab();

    a.rememberMigration(migration(1));
    b.rememberMigration(migration(2));

    expect(localStorage.getItem(INCARNATION)).toBe("theirs");
    expect(hashesOf(stored())).toEqual([hashOf(1), hashOf(2)]);
  });

  it("shows and follows a deposit as storage refuses a wallet from before its incarnation at its first unlock, keeps both once storage frees, and lets no late write land after another tab resets", async () => {
    const refusing = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(full);
    const { deposits, names, unlock } = await loadTab();

    await unlock();
    deposits.rememberDepositTransaction(DEPOSIT, { amountLux: 1n });

    expect(get(deposits.depositActivityStore)).toMatchObject([
      { amountLux: "1", transactionHash: DEPOSIT },
    ]);
    expect(deposits.getRememberedDepositTransaction(DEPOSIT)).not.toBeNull();

    refusing.mockRestore();

    // Work begun now, which writes after the reset.
    const late = names.walletDataScope();

    deposits.updateDepositTransaction(DEPOSIT, { stage: "l2_pending" });

    expect(localStorage.getItem(INCARNATION)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(DEPOSITS) ?? "[]")).toMatchObject([
      { amountLux: "1", stage: "l2_pending", transactionHash: DEPOSIT },
    ]);

    vi.resetModules();
    await (await import("../walletData")).forgetEveryWalletData();

    const left = localStorage.getItem(DEPOSITS);

    deposits.rememberDepositTransaction(DEPOSIT, { amountLux: 2n }, late);

    expect(localStorage.getItem(INCARNATION)).toBeNull();
    expect(localStorage.getItem(DEPOSITS)).toBe(left);
  });

  it("takes the incarnation another tab keeps once storage frees, for a wallet from before storage refused its own", async () => {
    const refusing = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(full);
    const a = await openTab();

    refusing.mockRestore();

    const b = await openTab();
    const theirs = localStorage.getItem(INCARNATION);

    a.rememberMigration(migration(1));
    b.rememberMigration(migration(2));

    expect(theirs).not.toBeNull();
    expect(localStorage.getItem(INCARNATION)).toBe(theirs);
    expect(hashesOf(stored())).toEqual([hashOf(1), hashOf(2)]);
  });

  it("lets no late write land as another tab resets while storage still refuses the incarnation, as the reset locks this tab", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(full);

    const { deposits, names, unlock } = await loadTab();

    await unlock();

    const late = names.walletDataScope();

    vi.restoreAllMocks();
    // This tab locks, as the reset tells it.
    names.useWalletDataSuffix("", "", false);
    deposits.rememberDepositTransaction(DEPOSIT, {}, late);

    expect(localStorage.getItem(INCARNATION)).toBeNull();
    expect(localStorage.getItem(DEPOSITS)).toBeNull();
  });
});
