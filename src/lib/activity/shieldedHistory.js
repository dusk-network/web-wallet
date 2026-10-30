/**
 * A profile's shielded history (phoenixHistory.js), worked out once its
 * notes are synced and kept from then on: from the notes the wallet cache
 * holds, their values from the profile's keys, and the blocks at their
 * heights, each asked for among decoys from the note tree's heights.
 */

import { Bookkeeper, Bookmark } from "@dusk/w3sper";

import walletCache from "$lib/wallet-cache";

import {
  StaleActivityError,
  getActivityEpoch,
  getNoteHeightPool,
  getShieldedHistoryRecord,
  putNoteHeightPool,
  putShieldedHistoryRecord,
} from "./activityStore";
import { activityNetworkKey, archiveAt } from "./activityHistory";
import {
  buildShieldedHistory,
  fetchBlocks,
  leafInfo,
  pickHeights,
  readNoteHeights,
} from "./phoenixHistory";

/** @param {Uint8Array} bytes */
const bytesToHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * How many leaves the note tree has.
 *
 * @param {any} network A w3sper Network
 * @returns {Promise<bigint>}
 */
async function noteTreeSize(network) {
  const response = await network.contracts.transferContract.call.num_notes();
  const buffer = await response.arrayBuffer();

  return new Bookmark(new Uint8Array(buffer)).asUint();
}

/**
 * The note tree's heights on this network: kept, read once from the tree,
 * and extended with the leaves added since (the tree keeps growing). Null
 * while the tree can't be read.
 *
 * @param {any} network A w3sper Network
 * @param {string} nodeUrl
 * @param {number} epoch
 * @returns {Promise<number[] | null>}
 */
async function noteHeightPool(network, nodeUrl, epoch) {
  const key = activityNetworkKey(nodeUrl);
  const kept = await getNoteHeightPool(key).catch(() => null);
  const have =
    kept?.heights?.length && Number.isSafeInteger(kept.notes)
      ? BigInt(kept.notes)
      : 0n;
  const total = await noteTreeSize(network);

  if (!total) {
    return null;
  }

  if (have && kept && total <= have) {
    return kept.heights;
  }

  const added = await readNoteHeights(network, total, { from: have });

  if (!added) {
    return null;
  }

  const heights =
    have && kept ? [...new Set([...kept.heights, ...added])] : added;

  await putNoteHeightPool(key, heights, Number(total), epoch).catch(() => {});

  return heights;
}

/**
 * One note's value, from the profile's keys.
 *
 * @param {Profile} profile
 * @param {Uint8Array} nullifier
 * @param {Uint8Array} leaf
 * @returns {Promise<bigint>}
 */
async function noteValue(profile, nullifier, leaf) {
  const keeper = new Bookkeeper(
    /** @type {any} */ ({ address: async () => new Map([[nullifier, leaf]]) })
  );
  const balance = /** @type {AddressBalance} */ (
    await keeper.balance(profile.address)
  );

  return BigInt(balance?.value ?? 0n);
}

/**
 * The profile's notes, unspent and spent, as the wallet cache keeps them.
 *
 * @param {string} address
 */
async function cachedNotes(address) {
  const [unspent, spent] = await Promise.all([
    walletCache.getUnspentNotes([address]),
    walletCache.getSpentNotes([address]),
  ]);

  return [
    ...unspent.map((n) => ({
      leaf: n.note,
      nullifier: n.nullifier,
      spent: false,
    })),
    ...spent.map((n) => ({
      leaf: n.note,
      nullifier: n.nullifier,
      spent: true,
    })),
  ];
}

/**
 * The notes they were worked out from: the same set needs no new lookups.
 *
 * @param {{ leaf: Uint8Array, spent: boolean }[]} rows
 */
const fingerprintOf = (rows) =>
  rows
    .map((r) => `${leafInfo(r.leaf).pos}${r.spent ? "s" : ""}`)
    .sort()
    .join(",");

/**
 * @typedef {{
 *   isCurrent: () => boolean,
 *   network: () => Promise<any>,
 *   nodeUrl: string,
 *   profile: Profile,
 *   synced: boolean,
 * }} ShieldedHistoryOptions `isCurrent`: whether the wallet, profile and
 *   node are still the ones the build began with; `synced`: whether the
 *   shielded sync has found every note.
 */

/** @type {Map<string, Promise<{ entries: ActivityRow[], pending?: boolean }>>} */
const runs = new Map();

/**
 * The profile's notes with their values, from its keys.
 *
 * @param {Profile} profile
 * @param {{ leaf: Uint8Array, nullifier: Uint8Array, spent: boolean }[]} rows
 * @returns {Promise<ShieldedNote[]>}
 */
async function valuedNotes(profile, rows) {
  /** @type {ShieldedNote[]} */
  const notes = [];

  for (const r of rows) {
    notes.push({
      leaf: r.leaf,
      nullifier: bytesToHex(r.nullifier),
      spent: r.spent,
      value: await noteValue(profile, r.nullifier, r.leaf),
    });
  }

  return notes;
}

/**
 * @param {() => boolean} isCurrent
 */
function assertCurrent(isCurrent) {
  if (!isCurrent()) {
    throw new Error("The wallet changed while its shielded history was read");
  }
}

/**
 * Builds the history from its notes, when they changed since it was kept.
 *
 * @param {ShieldedHistoryOptions} options
 * @param {string} key
 * @param {{ leaf: Uint8Array, nullifier: Uint8Array, spent: boolean }[]} rows
 * @param {ShieldedHistoryRecord | null} kept
 * @param {number} epoch
 * @returns {Promise<{ entries: ActivityRow[], pending?: boolean }>}
 */
async function build(options, key, rows, kept, epoch) {
  const { isCurrent, nodeUrl, profile } = options;

  // A node without the archive reads no note tree either.
  await archiveAt(nodeUrl).assertArchive();

  const notes = await valuedNotes(profile, rows);

  assertCurrent(isCurrent);

  const asked = await heightsToAsk(options, notes, kept, epoch);

  // Without other heights to ask among, the node isn't asked at all: it
  // would name the profile's own.
  if (!asked?.decoys.length) {
    return { entries: kept?.entries ?? [], pending: true };
  }

  const blocks = await fetchBlocks(nodeUrl, asked.heights);

  assertCurrent(isCurrent);

  const entries = buildShieldedHistory({ blocks, notes });
  const fingerprint = fingerprintOf(rows);

  await keep(key, { decoys: asked.decoys, entries, fingerprint }, epoch);

  return { entries };
}

/**
 * The heights to ask for: the notes' own, among decoys from the note tree's;
 * null without a tree to draw them from.
 *
 * @param {ShieldedHistoryOptions} options
 * @param {ShieldedNote[]} notes
 * @param {ShieldedHistoryRecord | null} kept
 * @param {number} epoch
 */
async function heightsToAsk(options, notes, kept, epoch) {
  const pool = await noteHeightPool(
    await options.network(),
    options.nodeUrl,
    epoch
  );

  assertCurrent(options.isCurrent);

  const real = [...new Set(notes.map((n) => leafInfo(n.leaf).height))];
  const inTree = new Set(pool ?? []);

  // Not for a height the tree as read doesn't have either: no decoy could
  // be one.
  if (!pool || real.some((height) => !inTree.has(height))) {
    return null;
  }

  return pickHeights(pool, real, { keep: kept?.decoys ?? [] });
}

/**
 * Keeps the history, unless the wallet was reset meanwhile; a store that
 * can't keep it asks again next time.
 *
 * @param {string} key
 * @param {Omit<ShieldedHistoryRecord, "at" | "ownerKey">} record
 * @param {number} epoch
 */
async function keep(key, record, epoch) {
  await putShieldedHistoryRecord(key, record, epoch).catch((error) => {
    if (error instanceof StaleActivityError) {
      throw error;
    }
  });
}

/**
 * @param {ShieldedHistoryOptions} options
 * @param {string} key
 * @returns {Promise<{ entries: ActivityRow[], pending?: boolean }>}
 */
async function readShieldedHistory(options, key) {
  // A reset of the activity store meanwhile refuses the write (StaleActivityError).
  const epoch = await getActivityEpoch();
  const rows = await cachedNotes(String(options.profile.address));

  // Notes still being discovered aren't the history yet: what is known
  // shows, marked pending, and is asked for again once they are.
  /** @param {ActivityRow[]} entries */
  const snapshot = (entries) =>
    options.synced ? { entries } : { entries, pending: true };

  if (!rows.length) {
    return snapshot([]);
  }

  const kept = await getShieldedHistoryRecord(key).catch(() => null);

  if (kept?.fingerprint === fingerprintOf(rows)) {
    return snapshot(kept.entries);
  }

  if (!options.synced) {
    return snapshot(kept?.entries ?? []);
  }

  return build(options, key, rows, kept, epoch);
}

/**
 * The profile's shielded history, worked out once its shielded notes are
 * synced and kept from then on. A profile without shielded notes reads
 * nothing. One build at a time per profile and node.
 *
 * @param {ShieldedHistoryOptions} options
 * @returns {Promise<{ entries: ActivityRow[], pending?: boolean }>}
 */
export function getShieldedHistory(options) {
  const key = `${activityNetworkKey(options.nodeUrl)}::${String(options.profile.address)}`;
  const running = runs.get(key);

  if (running) {
    return running;
  }

  const run = readShieldedHistory(options, key).finally(() => {
    if (runs.get(key) === run) {
      runs.delete(key);
    }
  });

  runs.set(key, run);

  return run;
}
