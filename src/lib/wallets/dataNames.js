/**
 * Where the open wallet's data is kept on this device: the names of its
 * cache and of its records, each with the wallet's own ending. The wallet
 * whose data is kept as it was before this device kept more than one
 * wallet (the directory's `legacy`) has none; every other wallet has
 * ":<its vault ID>".
 */

import { readDirectory } from "./directory";

let suffix = "";

/** The open wallet's vault ID: "" for none, or one without a password. */
let openKey = "";

/** How many times a wallet opened here, or every one locked. */
let opened = 0;

/** The open wallet's ending: "" for the wallet with the names of before. */
export const walletDataSuffix = () => suffix;

/**
 * The ending of a wallet's names.
 *
 * @param {string} key Its vault ID: "" for a wallet without a password
 * @param {string} legacy The vault ID of the wallet with the names of before
 */
export const suffixOf = (key, legacy) =>
  !key || key === legacy ? "" : `:${key}`;

/**
 * Makes the names the open wallet's, as it opens, or none's as every wallet
 * locks.
 *
 * @param {string} next Its ending (suffixOf)
 * @param {string} [key] Its vault ID
 */
export function useWalletDataSuffix(next, key = "") {
  suffix = next;
  openKey = key;
  opened += 1;
}

/**
 * A name for the open wallet's data.
 *
 * @param {string} name The name as it was before wallets were kept apart
 */
export const walletDataName = (name) => `${name}${suffix}`;

/**
 * The open wallet's data, taken by work that writes it after it waits, as
 * the work begins:
 * - `name` gives that wallet's names, whichever wallet is open later;
 * - `isOpen` says whether it's still the wallet open, since no other opened
 *   and nothing locked;
 * - `keeps` says whether it's still on this device: a wallet removed since,
 *   or every wallet after a reset, keeps nothing more.
 *
 * @typedef {{ id: number, isOpen: () => boolean, keeps: () => boolean, name: (name: string) => string }} WalletDataScope
 * @returns {WalletDataScope}
 */
export function walletDataScope() {
  const at = opened;
  const own = suffix;
  const key = openKey;

  return {
    id: at,
    isOpen: () => at === opened,
    keeps: () => !key || key in readDirectory().wallets,
    name: (name) => `${name}${own}`,
  };
}

/**
 * Whether a record for a scope's wallet is written now: always while it's
 * open, and once another opened only while it's still on this device.
 *
 * @param {WalletDataScope} scope
 */
export const writesFor = (scope) => scope.isOpen() || scope.keeps();
