/**
 * Where the open wallet's data is kept on this device: the names of its
 * cache and of its records, each with the wallet's own ending. The wallet
 * whose data is kept as it was before this device kept more than one
 * wallet (the directory's `legacy`) has none; every other wallet has
 * ":<its vault ID>".
 */

let suffix = "";

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
 * Makes the names the open wallet's.
 *
 * @param {string} next Its ending (suffixOf)
 */
export function useWalletDataSuffix(next) {
  suffix = next;
}

/**
 * A name for the open wallet's data.
 *
 * @param {string} name The name as it was before wallets were kept apart
 */
export const walletDataName = (name) => `${name}${suffix}`;
