import { getCacheDatabase } from ".";

import {
  cacheBalances,
  cachePendingNotesInfo,
  cacheSpentNotes,
  cacheStakeInfo,
  cacheSyncInfo,
  cacheUnspentNotes,
} from "$lib/mock-data";

/**
 * In IndexedDB if we write a Uint8Array, we get
 * back an ArrayBuffer when we retrieve the data.
 *
 * In `fake-indexeddb` this is not the case, so
 * we intentionally write ArrayBuffers from the
 * beginning.
 */
/** @type {(records: WalletCachePendingNoteInfo[]) => WalletCacheDbPendingNoteInfo[]} */
const fixPending = (records) =>
  records.map((record) => ({
    ...record,
    nullifier: record.nullifier.buffer,
  }));
/** @type {(records: WalletCacheNote[]) => WalletCacheDbNote[]} */
const fixNotes = (records) =>
  records.map((record) => ({
    ...record,
    note: record.note.buffer,
    nullifier: record.nullifier.buffer,
  }));

/**
 * In IndexedDB objects with a getter will be
 * written without the getter.
 *
 * In `fake-indexeddb` apparently the getter is
 * written as a normal prop.
 *
 * Hence we remove it to simulate the real situation.
 */
/** @type {(entries: { account: string, stakeInfo: StakeInfo }[]) => WalletCacheDbStakeInfo[]} */
const fixStakeInfo = (entries) =>
  entries.map((entry) => {
    const { amount } = entry.stakeInfo;
    return {
      ...entry,
      stakeInfo: {
        ...entry.stakeInfo,
        amount: amount
          ? {
              eligibility: amount.eligibility,
              locked: amount.locked,
              value: amount.value,
            }
          : null,
      },
    };
  });

/** @type {() => Promise<void>} */
async function fillCacheDatabase() {
  const db = getCacheDatabase();

  await db.open();

  return db
    .transaction(
      "rw",
      [
        "balancesInfo",
        "pendingNotesInfo",
        "spentNotes",
        "stakeInfo",
        "syncInfo",
        "unspentNotes",
      ],
      async () => {
        await db.table("balancesInfo").bulkPut(cacheBalances);
        await db
          .table("pendingNotesInfo")
          .bulkPut(fixPending(cachePendingNotesInfo));
        await db.table("spentNotes").bulkPut(fixNotes(cacheSpentNotes));
        await db.table("stakeInfo").bulkPut(fixStakeInfo(cacheStakeInfo));
        await db.table("syncInfo").bulkPut(cacheSyncInfo);
        await db.table("unspentNotes").bulkPut(fixNotes(cacheUnspentNotes));
      }
    )
    .finally(() => {
      db.close();
    });
}

export default fillCacheDatabase;
