/**
 * Transaction history kept in this browser (IndexedDB, through Dexie): each
 * public account's entries from the archive node and the heights they cover,
 * per network, so the history paints at once and a refresh only asks for
 * what is new; the counterparties' name checks; the shielded history, with
 * the note tree's heights it hides its lookups among; and the wallet's own
 * transactions until the archive has them.
 *
 * It is its own database, beside the wallet cache, so that its count of
 * wallet resets outlives a reset: work that began before one writes nothing
 * after it.
 */

import { Dexie } from "dexie";

/** The row of the meta table that counts wallet resets. */
const LIFECYCLE = "lifecycle";

const TABLES = Object.freeze([
  "entries",
  "local",
  "meta",
  "names",
  "pools",
  "refusals",
  "shielded",
]);

const db = new Dexie("@dusk-network/activity", { autoOpen: true });

db.version(1).stores({
  // A public account's history entries, by owner and height.
  entries: "id, [ownerKey+blockHeight]",

  // The wallet's own transactions, until the archive has them.
  local: "id, ownerKey",

  // Each account's sync state, and the lifecycle row.
  meta: "ownerKey",

  // Counterparties' name checks.
  names: "id",

  // The note tree's heights per network, for the shielded history's decoys.
  pools: "network",

  // Nodes that answered without the archive, and when.
  refusals: "url",

  // Each profile's shielded history.
  shielded: "ownerKey",
});

/** The database, for tests. */
export const activityDatabase = db;

/** A write refused because the wallet was reset since its work began. */
export class StaleActivityError extends Error {
  constructor() {
    super("The wallet was reset since this work began");
    this.name = "StaleActivityError";
  }
}

/**
 * How many times the store was cleared for a wallet reset. Work that reads
 * it before it starts, and hands it to its writes, can't write anything back
 * after a reset: each write checks it in its own transaction.
 *
 * @returns {Promise<number>}
 */
export async function getActivityEpoch() {
  const life = await db.table("meta").get(LIFECYCLE);

  return Number(life?.epoch) || 0;
}

/**
 * One write transaction over `tables` that runs `write()` only while the
 * store's epoch is still `epoch` (no check when it is undefined).
 *
 * @param {string[]} tables
 * @param {number | undefined} epoch
 * @param {() => Promise<unknown>} write
 * @returns {Promise<void>}
 */
async function guardedWrite(tables, epoch, write) {
  await db.transaction("rw", [...new Set(["meta", ...tables])], async () => {
    if (epoch !== undefined && (await getActivityEpoch()) !== epoch) {
      throw new StaleActivityError();
    }

    await write();
  });
}

/**
 * The key one account's history is kept under on one network.
 *
 * @param {string} networkKey
 * @param {string} account
 */
export function activityOwnerKey(networkKey, account) {
  return `${String(networkKey)}::${String(account)}`;
}

/**
 * The sync state of an account, or null before its first sync.
 *
 * @param {string} ownerKey
 * @returns {Promise<ActivityMeta | null>}
 */
export async function getActivityMeta(ownerKey) {
  return (await db.table("meta").get(ownerKey)) ?? null;
}

/**
 * Keep a sync step: its entries and the new sync state, which `update` makes
 * from the state kept now, in one transaction, so two tabs syncing the same
 * account never lose each other's coverage.
 *
 * @param {string} ownerKey
 * @param {ActivityStoredEntry[]} entries
 * @param {(meta: ActivityMeta | null) => import("@dusk-network/app-core/history").HistoryState} update
 * @param {number} [epoch] getActivityEpoch when the work began
 * @returns {Promise<ActivityMeta>} the state kept
 */
export async function commitActivityStep(ownerKey, entries, update, epoch) {
  /** @type {ActivityMeta | null} */
  let next = null;

  await guardedWrite(["entries"], epoch, async () => {
    const metaTable = db.table("meta");
    const entryTable = db.table("entries");

    next = { ...update((await metaTable.get(ownerKey)) ?? null), ownerKey };
    await metaTable.put(next);

    for (const entry of entries) {
      // An entry read again (the finality overlap) is the same row: it keeps
      // the details already added to it.
      const id = `${ownerKey}::${entry.hash}`;
      const kept = await entryTable.get(id);

      await entryTable.put({ ...kept, ...entry, id, ownerKey });
    }
  });

  return /** @type {ActivityMeta} */ (/** @type {unknown} */ (next));
}

/**
 * Add details (time, outcome, fee, call) to kept entries, by hash. Entries
 * that are not kept are left alone.
 *
 * @param {string} ownerKey
 * @param {Map<string, ActivityDetails>} details
 * @param {number} [epoch] getActivityEpoch when the work began
 */
export async function patchActivityEntries(ownerKey, details, epoch) {
  if (!details?.size) {
    return;
  }

  await guardedWrite(["entries"], epoch, async () => {
    const table = db.table("entries");

    for (const [hash, patch] of details) {
      const kept = await table.get(`${ownerKey}::${hash}`);

      if (kept) {
        await table.put({ ...kept, ...patch });
      }
    }
  });
}

/**
 * Kept entries, newest first: at most `limit` of them, below `before` when
 * given.
 *
 * @param {string} ownerKey
 * @param {{ before?: number, limit?: number }} [options]
 * @returns {Promise<ActivityStoredEntry[]>}
 */
export async function listActivityEntries(
  ownerKey,
  { before, limit = 200 } = {}
) {
  const bounded = Number.isFinite(before);

  return db
    .table("entries")
    .where("[ownerKey+blockHeight]")
    .between(
      [ownerKey, Dexie.minKey],
      [ownerKey, bounded ? before : Dexie.maxKey],
      true,
      !bounded
    )
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Forget all that is kept of a network's chain, for another chain under the
 * same name (a reset devnet or local node): every account's history and
 * sync state, the wallet's own records, the shielded histories and the note
 * tree's heights.
 *
 * @param {string} network
 * @param {number} [epoch] getActivityEpoch when the work began
 */
export async function clearChainActivity(network, epoch) {
  const prefix = `${network}::`;

  await guardedWrite(
    ["entries", "local", "pools", "shielded"],
    epoch,
    async () => {
      await db.table("meta").where("ownerKey").startsWith(prefix).delete();
      await db
        .table("entries")
        .where("[ownerKey+blockHeight]")
        .between([prefix, Dexie.minKey], [`${prefix}\uffff`, Dexie.maxKey])
        .delete();
      await db.table("local").where("ownerKey").startsWith(prefix).delete();
      await db.table("shielded").where("ownerKey").startsWith(prefix).delete();
      await db.table("pools").delete(network);
    }
  );
}

/**
 * Kept name checks of counterparties, by account: `{ name, at }`, `name` null
 * for an account without one.
 *
 * @param {string} network
 * @param {string[]} accounts
 * @returns {Promise<Map<string, { at: number, name: string | null }>>}
 */
export async function getCounterpartyNames(network, accounts) {
  const out = new Map();

  if (!accounts.length) {
    return out;
  }

  const rows = await db
    .table("names")
    .bulkGet(accounts.map((account) => `${network}::${account}`));

  rows.forEach((row, i) => {
    if (row) {
      out.set(accounts[i], { at: Number(row.at) || 0, name: row.name ?? null });
    }
  });

  return out;
}

/**
 * Keep name checks of counterparties.
 *
 * @param {string} network
 * @param {Map<string, string | null>} names By account
 * @param {{ at?: number, epoch?: number }} [options] `epoch`: getActivityEpoch when the lookups began
 */
export async function putCounterpartyNames(
  network,
  names,
  { at = Date.now(), epoch } = {}
) {
  if (!names.size) {
    return;
  }

  await guardedWrite(["names"], epoch, () =>
    db.table("names").bulkPut(
      [...names].map(([account, name]) => ({
        account,
        at,
        id: `${network}::${account}`,
        name: name ?? null,
        network,
      }))
    )
  );
}

/**
 * The note tree's distinct heights on a network, kept from one read of the
 * tree: `{ network, heights, notes }`, or null.
 *
 * @param {string} network
 * @returns {Promise<{ at: number, heights: number[], network: string, notes: number } | null>}
 */
export async function getNoteHeightPool(network) {
  return (await db.table("pools").get(network)) ?? null;
}

/**
 * Keep a network's note-tree heights.
 *
 * @param {string} network
 * @param {number[]} heights
 * @param {number} notes How many leaves they come from
 * @param {number} [epoch] getActivityEpoch when the work began
 */
export async function putNoteHeightPool(network, heights, notes, epoch) {
  await guardedWrite(["pools"], epoch, () =>
    db.table("pools").put({ at: Date.now(), heights, network, notes })
  );
}

/**
 * A profile's kept shielded history, or null.
 *
 * @param {string} ownerKey
 * @returns {Promise<ShieldedHistoryRecord | null>}
 */
export async function getShieldedHistoryRecord(ownerKey) {
  return (await db.table("shielded").get(ownerKey)) ?? null;
}

/**
 * Keep a profile's shielded history, with the decoy heights it was asked
 * among.
 *
 * @param {string} ownerKey
 * @param {Omit<ShieldedHistoryRecord, "at" | "ownerKey">} record
 * @param {number} [epoch] getActivityEpoch when the work began
 */
export async function putShieldedHistoryRecord(ownerKey, record, epoch) {
  await guardedWrite(["shielded"], epoch, () =>
    db.table("shielded").put({ ...record, at: Date.now(), ownerKey })
  );
}

/**
 * The wallet's own transactions of an account, kept until the archive has
 * them.
 *
 * @param {string} ownerKey
 * @returns {Promise<ActivityLocalRecord[]>}
 */
export async function listLocalTransactions(ownerKey) {
  return db.table("local").where("ownerKey").equals(ownerKey).toArray();
}

/**
 * Keep one of the wallet's own transactions, or update it.
 *
 * @param {string} ownerKey
 * @param {Partial<ActivityLocalRecord> & { hash: string }} record
 * @param {number} [epoch] getActivityEpoch when the work began
 */
export async function putLocalTransaction(ownerKey, record, epoch) {
  const hash = String(record.hash).toLowerCase();
  const id = `${ownerKey}::${hash}`;

  await guardedWrite(["local"], epoch, async () => {
    const kept = await db.table("local").get(id);

    await db.table("local").put({ ...kept, ...record, hash, id, ownerKey });
  });
}

/**
 * Forget the wallet's own records of transactions the archive now has.
 *
 * @param {string} ownerKey
 * @param {string[]} hashes
 */
export async function deleteLocalTransactions(ownerKey, hashes) {
  if (hashes.length) {
    await db
      .table("local")
      .bulkDelete(
        hashes.map((hash) => `${ownerKey}::${String(hash).toLowerCase()}`)
      );
  }
}

/**
 * When `url` last answered without the archive, or null.
 *
 * @param {string} url
 * @returns {Promise<number | null>}
 */
export async function getArchiveRefusal(url) {
  const row = await db.table("refusals").get(String(url));

  return Number.isFinite(row?.at) ? row.at : null;
}

/**
 * Note that `url` answered without the archive.
 *
 * @param {string} url
 * @param {number} [at]
 */
export async function putArchiveRefusal(url, at = Date.now()) {
  await db.table("refusals").put({ at, url: String(url) });
}

/**
 * Forget everything kept here, for a wallet reset, and count the reset: work
 * that began before it writes nothing after it (getActivityEpoch).
 */
export async function clearActivityStore() {
  await db.transaction("rw", [...TABLES], async () => {
    const epoch = (await getActivityEpoch()) + 1;

    for (const name of TABLES) {
      await db.table(name).clear();
    }

    await db.table("meta").put({ epoch, ownerKey: LIFECYCLE });
  });
}
