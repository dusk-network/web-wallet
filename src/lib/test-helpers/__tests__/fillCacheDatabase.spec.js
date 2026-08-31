import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheBalances,
  cachePendingNotesInfo,
  cacheSpentNotes,
  cacheStakeInfo,
  cacheSyncInfo,
  cacheUnspentNotes,
} from "$lib/mock-data";

import { fillCacheDatabase, getCacheDatabase, sortByNullifier } from "..";

/**
 * We need to sort the entries in tests as the
 * database doesn't guarantee a sort order.
 *
 * @typedef {{ nullifier: ArrayBuffer }} T
 * @type {<U extends T>(entries: U[]) => U[]}
 */
const sortByDbNullifier = (entries) =>
  entries.toSorted((a, b) =>
    new Uint8Array(a.nullifier)
      .toString()
      .localeCompare(new Uint8Array(b.nullifier).toString())
  );

/**
 * @template {{ account: string }} T
 * @param {T[]} entries
 */
function sortByAccount(entries) {
  return entries.toSorted((a, b) => a.account.localeCompare(b.account));
}

/**
 * @template {{ address: string }} T
 * @param {T[]} entries
 */
function sortByAddress(entries) {
  return entries.toSorted((a, b) => a.address.localeCompare(b.address));
}

/** @type {(entry: WalletCacheNote) => WalletCacheDbNote} */
const toDbNote = (entry) => ({
  ...entry,
  note: entry.note.buffer,
  nullifier: entry.nullifier.buffer,
});

describe("fillCacheDatabase", () => {
  beforeEach(async () => {
    await getCacheDatabase().delete({ disableAutoOpen: false });
  });

  it("should fill the database tables with mock data", async () => {
    const expectedPendingNotesInfo = sortByNullifier(cachePendingNotesInfo).map(
      (v) => ({ ...v, nullifier: v.nullifier.buffer })
    );
    const expectedSpentNotes = sortByNullifier(cacheSpentNotes).map(toDbNote);
    const expectedUnspentNotes =
      sortByNullifier(cacheUnspentNotes).map(toDbNote);

    await fillCacheDatabase();

    const db = getCacheDatabase();

    await db.open();

    await expect(
      db.table("balancesInfo").toArray().then(sortByAddress)
    ).resolves.toStrictEqual(sortByAddress(cacheBalances));
    await expect(
      db.table("pendingNotesInfo").toArray().then(sortByDbNullifier)
    ).resolves.toStrictEqual(expectedPendingNotesInfo);
    await expect(
      db.table("spentNotes").toArray().then(sortByDbNullifier)
    ).resolves.toStrictEqual(expectedSpentNotes);
    await expect(
      db.table("stakeInfo").toArray().then(sortByAccount)
    ).resolves.toStrictEqual(
      sortByAccount(cacheStakeInfo).map((entry) => ({
        ...entry,
        stakeInfo: {
          ...entry.stakeInfo,
          amount: {
            eligibility: entry.stakeInfo.amount.eligibility,
            locked: entry.stakeInfo.amount.locked,
            value: entry.stakeInfo.amount.value,
          },
        },
      }))
    );
    await expect(db.table("syncInfo").toArray()).resolves.toStrictEqual(
      cacheSyncInfo
    );
    await expect(
      db.table("unspentNotes").toArray().then(sortByDbNullifier)
    ).resolves.toStrictEqual(expectedUnspentNotes);

    db.close();
  });
});
