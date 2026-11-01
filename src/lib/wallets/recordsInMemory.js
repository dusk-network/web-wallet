/**
 * The records of one kind the screens show, the open wallet's, and each
 * wallet's that storage refused to keep, as when it's full, by the wallet's
 * time here (WalletDataScope's `owner`). The next write for that wallet is
 * made over what storage keeps and those: a write storage refused isn't
 * undone by the next, and doesn't leave the screen.
 */

import { writable } from "svelte/store";

/** @typedef {import("./dataNames").WalletDataScope} WalletDataScope */

/**
 * @template T
 * @param {T} none
 */
export function recordsInMemory(none) {
  const shown = writable(none);

  /** @type {Map<string, T>} */
  const refused = new Map();

  return {
    /**
     * Forgets every wallet's, as a reset does.
     */
    clear() {
      refused.clear();
      shown.set(none);
    },

    /**
     * Keeps a wallet's records as written: in this tab where storage
     * refused them, shown while it's the one open.
     *
     * @param {T} records
     * @param {WalletDataScope} scope
     * @param {boolean} stored Whether storage took them
     */
    keep(records, scope, stored) {
      if (stored) {
        refused.delete(scope.owner);
      } else {
        refused.set(scope.owner, records);
      }

      if (scope.isShown()) {
        shown.set(records);
      }
    },

    /**
     * A wallet's records storage refused: undefined for none.
     *
     * @param {WalletDataScope} scope
     * @returns {T | undefined}
     */
    refusedOf: (scope) => refused.get(scope.owner),

    /**
     * Shows the open wallet's records, as it opens or a screen reads them
     * again.
     *
     * @param {T} records
     */
    show(records) {
      shown.set(records);
    },

    subscribe: shown.subscribe,
  };
}

/**
 * Writes a wallet's records to storage: whether storage took them.
 *
 * @param {string} name
 * @param {unknown} records
 */
export function storeRecords(name, records) {
  try {
    localStorage.setItem(name, JSON.stringify(records));

    return true;
  } catch {
    return false;
  }
}

/**
 * A wallet's records as storage keeps them, with those storage refused
 * that it doesn't have first: for one in both, storage's, with what only
 * the refused one says.
 *
 * @template {object} T
 * @param {T[]} stored
 * @param {T[] | undefined} refused
 * @param {(record: T) => string} keyOf
 * @returns {T[]}
 */
export function withRefused(stored, refused, keyOf) {
  if (!refused?.length) {
    return stored;
  }

  const refusedByKey = new Map(
    refused.map((record) => [keyOf(record), record])
  );
  const storedKeys = new Set(stored.map(keyOf));

  return [
    ...refused.filter((record) => !storedKeys.has(keyOf(record))),
    ...stored.map((record) => ({
      ...refusedByKey.get(keyOf(record)),
      ...record,
    })),
  ];
}

/**
 * A wallet's records by key, as storage keeps them, with those storage
 * refused that it doesn't have: for one in both, storage's, with what only
 * the refused one says.
 *
 * @template {object} T
 * @param {Record<string, T>} stored
 * @param {Record<string, T> | undefined} refused
 * @returns {Record<string, T>}
 */
export function withRefusedByKey(stored, refused) {
  if (!refused) {
    return stored;
  }

  return Object.fromEntries(
    [...new Set([...Object.keys(refused), ...Object.keys(stored)])].map(
      (key) => [key, { ...refused[key], ...stored[key] }]
    )
  );
}
