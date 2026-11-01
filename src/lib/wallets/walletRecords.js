/**
 * A wallet's records of one kind, kept under its names ($lib/wallets/
 * dataNames), and shown in a store while it's open. While a wallet is open
 * in this tab, its store is what's true of them: a write changes the store,
 * then keeps the whole of it, and where storage refuses it, the screen
 * keeps it all the same. Another wallet's are changed as storage keeps
 * them, and a write storage refuses is lost. The store is read from storage
 * as the wallet opens, never later.
 */

import { get } from "svelte/store";

/** @typedef {import("./dataNames").WalletDataScope} WalletDataScope */

/**
 * @template T
 * @typedef {{ name: string, read: (scope: WalletDataScope) => T, store: import("svelte/store").Writable<T> }} WalletRecords
 *   `name` theirs before wallets were kept apart; `read` them from storage
 */

/**
 * A wallet's records: the open one's as shown, another's as kept.
 *
 * @template T
 * @param {WalletRecords<T>} records
 * @param {WalletDataScope} scope
 * @returns {T}
 */
export const recordsOf = ({ read, store }, scope) =>
  scope.isShown() ? get(store) : read(scope);

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

  const next = change(recordsOf(records, scope));

  if (scope.isShown() || scope.before) {
    records.store.set(next);
  }

  try {
    localStorage.setItem(scope.name(records.name), JSON.stringify(next));
  } catch {
    // The open wallet's stay on screen; another's change is lost.
  }

  return next;
}
