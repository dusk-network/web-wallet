/**
 * A wallet's records of one kind, kept under its names ($lib/wallets/
 * dataNames), and shown in a store while it's open. The open wallet's are
 * what storage keeps, with this tab's changes storage hasn't kept laid
 * over them, record by record (`dirty`). A write keeps them all; once
 * storage takes it, there are none left. Where storage refuses it, they
 * stay: on screen, over what other tabs write as storage tells of it, and
 * in the next write. A record removed stays removed the same way. Another
 * wallet's records are changed as storage keeps them, and a write storage
 * refuses is lost.
 */

import { walletDataScope } from "./dataNames";

/** @typedef {import("./dataNames").WalletDataScope} WalletDataScope */

/**
 * @template T
 * @typedef {{ keyOf?: (record: any) => string, name: string, read: (scope: WalletDataScope) => T, store: import("svelte/store").Writable<T> }} RecordsKept
 *   `name` theirs before wallets were kept apart; `read` them from storage;
 *   `keyOf` a record's key in a list of them, none for records kept by key
 */

/**
 * @template T
 * @typedef {RecordsKept<T> & { dirty: Map<string, any> }} WalletRecords
 *   `dirty` this tab's changes storage hasn't kept, by key: null for a
 *   record removed
 */

/**
 * @param {WalletRecords<any>} records
 * @param {any} value
 * @returns {[string, any][]}
 */
const entriesOf = ({ keyOf }, value) =>
  keyOf
    ? value.map((/** @type {any} */ record) => [keyOf(record), record])
    : Object.entries(value);

/**
 * @param {WalletRecords<any>} records
 * @param {[string, any][]} entries
 */
const valueOf = ({ keyOf }, entries) =>
  keyOf ? entries.map(([, record]) => record) : Object.fromEntries(entries);

/**
 * Records as storage keeps them, with this tab's changes over them, record
 * by record: those storage doesn't have first, and those removed gone.
 *
 * @param {WalletRecords<any>} records
 * @param {any} stored
 */
function withDirty(records, stored) {
  const { dirty } = records;

  if (dirty.size === 0) {
    return stored;
  }

  const entries = entriesOf(records, stored);
  const keys = new Set(entries.map(([key]) => key));
  const fresh = [...dirty].filter(([key]) => !keys.has(key));
  const over = entries.map(
    /** @returns {[string, any]} */
    ([key, record]) => [key, dirty.has(key) ? dirty.get(key) : record]
  );

  return valueOf(
    records,
    [...fresh, ...over].filter(([, record]) => record !== null)
  );
}

/**
 * Keeps as this tab's, as storage refused them, the changes from `before`
 * to `after`, in `after`'s order, with those it had.
 *
 * @param {WalletRecords<any>} records
 * @param {any} before
 * @param {any} after
 */
function keepDirty(records, before, after) {
  const was = new Map(entriesOf(records, before));
  const now = new Map(entriesOf(records, after));
  const dirty = new Map();

  for (const [key, record] of now) {
    if (
      records.dirty.has(key) ||
      JSON.stringify(was.get(key)) !== JSON.stringify(record)
    ) {
      dirty.set(key, record);
    }
  }

  for (const key of [...was.keys(), ...records.dirty.keys()]) {
    if (!now.has(key)) {
      dirty.set(key, null);
    }
  }

  records.dirty = dirty;
}

/**
 * The open wallet's records, as shown: storage's, with this tab's over.
 *
 * @param {WalletRecords<any>} records
 * @param {WalletDataScope} scope
 */
const shownOf = (records, scope) => withDirty(records, records.read(scope));

/**
 * Records of one kind, each wallet's. As another tab writes the open
 * wallet's, storage tells this tab, and they're shown again: storage's,
 * with this tab's changes over them. That's between this tab's writes,
 * never during one, as each is done at once.
 *
 * @template T
 * @param {RecordsKept<T>} kept
 * @returns {WalletRecords<T>}
 */
export function walletRecords(kept) {
  const records = { ...kept, dirty: new Map() };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", ({ key }) => {
      const scope = walletDataScope();

      if (
        (key === null || key === scope.name(records.name)) &&
        scope.isShown() &&
        scope.keeps()
      ) {
        records.store.set(shownOf(records, scope));
      }
    });
  }

  return records;
}

/**
 * Shows the open wallet's records, as it opens: storage's, this tab having
 * changed none yet.
 *
 * @template T
 * @param {WalletRecords<T>} records
 * @returns {T}
 */
export function openRecords(records) {
  const value = records.read(walletDataScope());

  records.dirty = new Map();
  records.store.set(value);

  return value;
}

/**
 * A wallet's records: the open one's as shown, another's as kept.
 *
 * @template T
 * @param {WalletRecords<T>} records
 * @param {WalletDataScope} scope
 * @returns {T}
 */
export const recordsOf = (records, scope) =>
  scope.isShown() ? shownOf(records, scope) : records.read(scope);

/**
 * Changes a wallet's records, as work for it begun as `scope` was taken
 * finds them: nothing once its incarnation ended.
 *
 * @template T
 * @param {WalletRecords<T>} records
 * @param {WalletDataScope} scope
 * @param {(records: T) => T} change
 * @returns {T | null} The records as changed: null for none
 */
export function changeRecords(records, scope, change) {
  if (!scope.keeps()) {
    return null;
  }

  const shown = scope.isShown();
  const before = recordsOf(records, scope);
  const after = change(before);
  let kept = true;

  try {
    localStorage.setItem(scope.name(records.name), JSON.stringify(after));
  } catch {
    // The open wallet's stay this tab's to keep; another's change is lost.
    kept = false;
  }

  if (shown) {
    if (kept) {
      records.dirty = new Map();
    } else {
      keepDirty(records, before, after);
    }

    records.store.set(after);
  }

  return after;
}
