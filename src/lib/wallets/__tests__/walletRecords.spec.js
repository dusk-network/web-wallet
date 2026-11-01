import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const APP = CONFIG.LOCAL_STORAGE_APP_KEY;
const KEY = "k";
const MIGRATIONS = `${APP}-migrations:${KEY}`;
const ARRIVALS = `${APP}-transfer-arrivals:${KEY}`;

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

/** Storage refusing the next write, as a full one does. */
const refuseOnce = () =>
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new DOMException(
      "The quota has been exceeded.",
      "QuotaExceededError"
    );
  });

/**
 * Tells the tabs of a write, as the browser tells every tab but the one
 * that wrote: that one's shows what it wrote already.
 *
 * @param {string} key
 */
const tellTabs = (key) =>
  window.dispatchEvent(new StorageEvent("storage", { key }));

/** A tab with the wallet open: its own memory, the same storage. */
async function openTab() {
  vi.resetModules();

  const names = await import("../dataNames");
  const tab = await import("$lib/bridge/migrationActivity");

  names.keepIncarnation(KEY);
  names.useWalletDataSuffix(`:${KEY}`, KEY);
  tab.hydrateMigrations();

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
});
