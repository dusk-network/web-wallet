/**
 * A profile's shielded history (`@dusk-network/app-core/shielded`), worked
 * out once its notes are synced and kept from then on: from the notes the
 * wallet cache holds, their values from the profile's keys, and the node's
 * note tree, kept in this browser.
 */

import { Bookkeeper, Bookmark } from "@dusk/w3sper";
import { shieldedHistory } from "@dusk-network/app-core/shielded";

import { currentWalletCache } from "$lib/wallet-cache";

import {
  StaleActivityError,
  getActivityEpoch,
  getNoteHeightPool,
  getShieldedHistoryRecord,
  putNoteHeightPool,
  putShieldedHistoryRecord,
  updateShieldedHistoryRecord,
} from "./activityStore";
import { activityNetworkKey, archiveAt } from "./activityHistory";

/** @typedef {import("@dusk-network/app-core/shielded").ShieldedEntry} ShieldedEntry */

/**
 * An entry of the shielded history as this browser keeps it.
 *
 * @param {ShieldedEntry} e
 * @returns {KeptShieldedRow}
 */
const rowOf = (e) => ({
  amount: e.direction === "self" ? undefined : e.value,
  blockHeight: e.blockHeight,
  direction: e.direction,
  error: e.error,
  feePaid: e.fee ?? undefined,
  hash: e.hash,
  kind: e.kind,
  privacy: "shielded",
  source: "shielded",
  status: e.success ? "executed" : "failed",
  timestamp: e.timestamp ?? undefined,
});

/**
 * A kept row as the entry it was.
 *
 * @param {KeptShieldedRow} row
 * @returns {ShieldedEntry}
 */
const entryOf = (row) => ({
  blockHeight: Number(row.blockHeight),
  direction: row.direction ?? "in",
  ...(row.error ? { error: row.error } : {}),
  fee: row.feePaid ?? null,
  hash: row.hash,
  kind: row.kind ?? "transfer",
  success: row.status !== "failed",
  timestamp: row.timestamp ?? null,
  value: row.amount ?? "0",
});

/**
 * A kept record as the history reads it: its rows as the entries they were.
 *
 * @param {ShieldedHistoryRecord} kept
 */
const recordOf = (kept) => ({ ...kept, entries: kept.entries.map(entryOf) });

/**
 * A write that rejects only when the wallet was reset meanwhile; a store
 * that can't keep a history asks again next time.
 *
 * @param {unknown} error
 */
function unlessReset(error) {
  if (error instanceof StaleActivityError) {
    throw error;
  }
}

/**
 * The node's note tree, as the transfer contract gives it.
 *
 * @param {() => Promise<any>} network A w3sper Network
 * @returns {import("@dusk-network/app-core/shielded").NoteTree}
 */
const noteTree = (network) => ({
  async leaves(from) {
    const { call } = (await network()).contracts.transferContract;

    return call.leaves_from_pos(Bookmark.from(from).data, {
      headers: { "Rusk-Feeder": "true" },
    });
  },
  async size() {
    const { call } = (await network()).contracts.transferContract;
    const response = await call.num_notes();

    return new Bookmark(new Uint8Array(await response.arrayBuffer())).asUint();
  },
});

/**
 * One note's value, from the profile's keys.
 *
 * @param {Profile} profile
 * @param {import("@dusk-network/app-core/shielded").OwnedNote} note
 * @returns {Promise<bigint>}
 */
async function noteValue(profile, { leaf, nullifier }) {
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
    currentWalletCache().getUnspentNotes([address]),
    currentWalletCache().getSpentNotes([address]),
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
 * @typedef {{
 *   isCurrent: () => boolean,
 *   network: () => Promise<any>,
 *   nodeUrl: string,
 *   profile: Profile,
 *   synced: boolean,
 * }} ShieldedHistoryOptions `isCurrent`: whether the wallet, profile and
 *   node are still the ones the read began with; `synced`: whether the
 *   shielded sync has found every note.
 */

/** @type {Map<string, Promise<{ entries: ShieldedEntry[], pending?: boolean }>>} */
const runs = new Map();

/**
 * @param {ShieldedHistoryOptions} options
 * @param {string} key
 * @returns {Promise<{ entries: ShieldedEntry[], pending?: boolean }>}
 */
async function readShieldedHistory(options, key) {
  const { isCurrent, network, nodeUrl, profile, synced } = options;
  // A reset of the activity store meanwhile refuses the write (StaleActivityError).
  const epoch = await getActivityEpoch();
  const pools = activityNetworkKey(nodeUrl);
  const { entries, pending } = await shieldedHistory({
    archive: archiveAt(nodeUrl),
    isCurrent,
    notes: () => cachedNotes(String(profile.address)),
    store: {
      async get() {
        const kept = await getShieldedHistoryRecord(key);

        return kept && recordOf(kept);
      },
      // Kept unless the wallet was reset meanwhile; a store that can't keep
      // it asks again next time.
      put: (record) =>
        putShieldedHistoryRecord(
          key,
          { ...record, entries: record.entries.map(rowOf) },
          epoch
        ).catch(unlessReset),
      // In one transaction: two tabs reading this history at once ask
      // among the same decoys.
      update: (change) =>
        updateShieldedHistoryRecord(
          key,
          (kept) => {
            const next = change(kept && recordOf(kept));

            return { ...next, entries: next.entries.map(rowOf) };
          },
          epoch
        ).then(recordOf, unlessReset),
    },
    synced,
    tree: noteTree(network),
    treeHeights: {
      get: () => getNoteHeightPool(pools),
      put: ({ heights, notes }) =>
        putNoteHeightPool(pools, heights, notes, epoch),
    },
    valueOf: (note) => noteValue(profile, note),
  });

  return pending ? { entries, pending } : { entries };
}

/**
 * The profile's shielded history, worked out once its shielded notes are
 * synced and kept from then on. A profile without shielded notes reads
 * nothing. One read at a time per profile and node.
 *
 * @param {ShieldedHistoryOptions} options
 * @returns {Promise<{ entries: ShieldedEntry[], pending?: boolean }>}
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
