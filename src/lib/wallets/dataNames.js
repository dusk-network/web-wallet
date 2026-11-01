/**
 * Where the open wallet's data is kept on this device: the names of its
 * cache and of its records, each with the wallet's own ending. The wallet
 * whose data is kept as it was before this device kept more than one
 * wallet (the directory's `legacy`) has none; every other wallet has
 * ":<its vault ID>".
 *
 * Each wallet, one without a password too, has an incarnation here: a
 * random ID under a name of its own (`<app>-incarnation:<vault ID>`),
 * written as it's set up or added, before anything else of it, and only
 * removed: by its removal, and by a reset. Work that writes a wallet's
 * records takes its incarnation as it begins, and writes only while it's
 * still there: a wallet removed since, or made again, gets none of it.
 */

const INCARNATION = `${CONFIG.LOCAL_STORAGE_APP_KEY}-incarnation:`;

/** The incarnations this tab ended, gone from them at once. */
const ended = new Set();

/**
 * A wallet's incarnation here: null for none.
 *
 * @param {string} key Its vault ID: "" for a wallet without a password
 * @returns {string | null}
 */
export function incarnationOf(key) {
  try {
    return localStorage.getItem(`${INCARNATION}${key}`);
  } catch {
    return null;
  }
}

/**
 * Starts a wallet's incarnation, as it's set up or added: throws where it
 * can't be kept, and then it isn't set up.
 *
 * @param {string} key Its vault ID: "" for a wallet without a password
 */
export function startIncarnation(key) {
  localStorage.setItem(`${INCARNATION}${key}`, crypto.randomUUID());
}

/**
 * Starts the incarnation of a wallet the vault holds that has none, as one
 * kept before wallets had them: where storage allows it.
 *
 * @param {string} key Its vault ID
 */
export function keepIncarnation(key) {
  if (incarnationOf(key) === null) {
    try {
      startIncarnation(key);
    } catch {
      // Nothing of it is written in this time, as storage is full anyway.
    }
  }
}

/**
 * Ends the incarnation kept under `name`: in this tab at once, then here.
 *
 * @param {string} name
 */
function endNamed(name) {
  try {
    const id = localStorage.getItem(name);

    if (id !== null) {
      ended.add(id);
    }

    localStorage.removeItem(name);
  } catch {
    // Nothing is kept where storage can't be read.
  }
}

/**
 * Ends a wallet's incarnation, as it's removed.
 *
 * @param {string} key Its vault ID
 */
export const endIncarnation = (key) => endNamed(`${INCARNATION}${key}`);

/** Ends every wallet's incarnation, as a reset does. */
export function endEveryIncarnation() {
  let names = /** @type {string[]} */ ([]);

  try {
    names = Object.keys(localStorage);
  } catch {
    // Nothing is kept where storage can't be read.
  }

  for (const name of names) {
    if (name.startsWith(INCARNATION)) {
      endNamed(name);
    }
  }
}

let suffix = "";

/** The open wallet's vault ID: "" for none, or one without a password. */
let openKey = "";

/** The open wallet's incarnation as it opened: null with none open. */
let openId = /** @type {string | null} */ (null);

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
 * locks (`open` false).
 *
 * @param {string} next Its ending (suffixOf)
 * @param {string} [key] Its vault ID
 * @param {boolean} [open]
 */
export function useWalletDataSuffix(next, key = "", open = true) {
  suffix = next;
  openKey = key;
  openId = open ? incarnationOf(key) : null;
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
 * - `isShown` says whether that wallet, in the same incarnation, is the one
 *   open in this tab now: whose records the screens show, kept in memory;
 * - `keeps` says whether its incarnation is still here: a write lands only
 *   then;
 * - `owner` names that wallet in that incarnation;
 * - `before` says it was taken before any wallet opened in this tab, when
 *   the names of before are the only ones, written as they always were.
 *
 * @typedef {{ before: boolean, id: number, isOpen: () => boolean, isShown: () => boolean, keeps: () => boolean, name: (name: string) => string, owner: string }} WalletDataScope
 * @returns {WalletDataScope}
 */
export function walletDataScope() {
  const at = opened;
  const own = suffix;
  const key = openKey;
  const id = openId;

  return {
    before: at === 0,
    id: at,
    isOpen: () => at === opened,
    isShown: () => at > 0 && id !== null && key === openKey && id === openId,
    keeps: () =>
      at === 0 || (id !== null && !ended.has(id) && incarnationOf(key) === id),
    name: (name) => `${name}${own}`,
    owner: `${key}\n${id}`,
  };
}
