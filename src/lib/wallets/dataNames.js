/**
 * Where the open wallet's data is kept on this device: the names of its
 * cache and of its records, each with the wallet's own ending. The wallet
 * whose data is kept as it was before this device kept more than one
 * wallet (the directory's `legacy`) has none; every other wallet has
 * ":<its vault ID>".
 */

/**
 * Each wallet's time on this device, as marks that change as it ends: every
 * wallet's as a reset, or a wallet set up in place of every one, ends them,
 * and one wallet's as it's removed. A wallet made again with the same vault
 * ID, or the same names, is another time of it. Kept beside the wallets'
 * data, in every tab: `{ all?: string, wallets?: Record<string, string> }`.
 */
const MARKS = `${CONFIG.LOCAL_STORAGE_APP_KEY}-wallet-marks`;

/** @returns {{ all?: string, wallets?: Record<string, string> }} */
function readMarks() {
  try {
    const marks = JSON.parse(localStorage.getItem(MARKS) ?? "{}");

    return marks && typeof marks === "object" ? marks : {};
  } catch {
    return {};
  }
}

/**
 * The time on this device of the wallet `key` is: "" for one without a
 * password.
 *
 * @param {string} key
 */
const timeOf = (key) => {
  const { all = "", wallets = {} } = readMarks();

  return `${all} ${wallets[key] ?? ""}`;
};

/** @param {{ all?: string, wallets?: Record<string, string> }} marks */
function writeMarks(marks) {
  try {
    localStorage.setItem(MARKS, JSON.stringify(marks));
  } catch {
    // Unwritable storage keeps nothing a late write would add to either.
  }
}

/** Ends every wallet's time here: a reset, or a wallet set up in place. */
export const endEveryWallet = () => writeMarks({ all: crypto.randomUUID() });

/**
 * Ends one wallet's time here, as it's removed.
 *
 * @param {string} key Its vault ID
 */
export function endWallet(key) {
  const marks = readMarks();

  writeMarks({
    ...marks,
    wallets: { ...marks.wallets, [key]: crypto.randomUUID() },
  });
}

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
 * - `isOpen` says whether it's still open as it was, since no other opened
 *   and nothing locked: what the work goes on doing;
 * - `isShown` says whether that wallet is the one open now, opened again
 *   since or not: whose records the screens show;
 * - `keeps` says whether that wallet is still here in the same time it was,
 *   which neither a reset nor its removal ended: a wallet without a
 *   password too;
 * - `owner` names that wallet in that time, as records kept in memory are.
 *
 * @typedef {{ id: number, isOpen: () => boolean, isShown: () => boolean, keeps: () => boolean, name: (name: string) => string, owner: string }} WalletDataScope
 * @returns {WalletDataScope}
 */
export function walletDataScope() {
  const at = opened;
  const own = suffix;
  const key = openKey;
  const time = timeOf(key);

  return {
    id: at,
    isOpen: () => at === opened,
    isShown: () => key === openKey && own === suffix,
    keeps: () => timeOf(key) === time,
    name: (name) => `${name}${own}`,
    owner: `${key}\n${own}\n${time}`,
  };
}

/**
 * Whether a record for a scope's wallet is written now: only while that
 * wallet is still here in the time the work began in.
 *
 * @param {WalletDataScope} scope
 */
export const writesFor = (scope) => scope.keeps();
