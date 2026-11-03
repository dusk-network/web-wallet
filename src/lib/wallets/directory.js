/**
 * The wallets on this device as the switcher shows them, by their vault ID
 * ($lib/vault): each one's name, when it was given one, and what it showed
 * the last time it was open: its wallet ID (its first public account, which
 * its contacts are kept by), its profiles' public accounts and shielded
 * addresses, which its history is kept by, and the block it was made at,
 * for one made here; and the names its profiles were given here, by
 * profile, "" for one without. With them, the wallet open last,
 * which the next unlock opens, and the wallet whose data is kept under the
 * names this device used before it kept more than one (`legacy`): the one
 * moved from earlier versions, or set up first. Nothing here is secret: the
 * phrases are in the vault.
 *
 * `${APP_KEY}-wallets`: { active, legacy, wallets: { [key]: { walletId, accounts, addresses, name?, height?, profileNames? } } }
 */

import { readable } from "svelte/store";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`;

/**
 * @typedef {{ accounts: string[], addresses: string[], height?: string, name?: string, profileNames?: string[], walletId: string }} DirectoryWallet
 * @typedef {{ active: string, legacy: string, wallets: Record<string, DirectoryWallet> }} WalletDirectory
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A wallet's name as given: one line, at most 32 characters; "" for none.
 *
 * @param {unknown} name
 */
export const normalizeWalletName = (name) =>
  String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);

/**
 * What a wallet is called: its name, or "Wallet 2" by its number.
 *
 * @param {{ n?: number, name?: string } | null | undefined} wallet
 */
export const walletLabel = (wallet) =>
  normalizeWalletName(wallet?.name) || `Wallet ${Number(wallet?.n) || 1}`;

/**
 * What a wallet's profile is called: the name it was given here, as a
 * wallet's name is kept, or "Profile 2" by its number.
 *
 * @param {string[] | undefined} names The wallet's profile names
 * @param {number} index The profile's
 */
export const profileNameAt = (names, index) =>
  normalizeWalletName(names?.[index]) || `Profile ${index + 1}`;

/**
 * A wallet's profile names as kept: one per profile, "" for one without,
 * none after the last one named; undefined for none.
 *
 * @param {unknown} names
 * @returns {string[] | undefined}
 */
function profileNamesOf(names) {
  const kept = Array.isArray(names)
    ? Array.from(names, (name) => normalizeWalletName(name))
    : [];

  while (kept.length && !kept.at(-1)) {
    kept.pop();
  }

  return kept.length ? kept : undefined;
}

/**
 * @param {any} entry
 * @returns {DirectoryWallet}
 */
function walletOf(entry) {
  const name = normalizeWalletName(entry?.name);
  const profileNames = profileNamesOf(entry?.profileNames);

  /** @param {unknown} list */
  const strings = (list) => (Array.isArray(list) ? list.map(String) : []);

  return {
    accounts: strings(entry?.accounts),
    addresses: strings(entry?.addresses),
    ...(typeof entry?.height === "string" && /^\d+$/.test(entry.height)
      ? { height: entry.height }
      : {}),
    ...(name ? { name } : {}),
    ...(profileNames ? { profileNames } : {}),
    walletId: typeof entry?.walletId === "string" ? entry.walletId : "",
  };
}

/** @returns {WalletDirectory} */
export function readDirectory() {
  /** @type {any} */
  let stored = null;

  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    stored = null;
  }

  return {
    active: typeof stored?.active === "string" ? stored.active : "",
    legacy: typeof stored?.legacy === "string" ? stored.legacy : "",
    wallets: isObject(stored?.wallets)
      ? Object.fromEntries(
          Object.entries(stored.wallets).map(([key, entry]) => [
            key,
            walletOf(entry),
          ])
        )
      : {},
  };
}

/** @type {Set<(directory: WalletDirectory) => void>} */
const listeners = new Set();

/**
 * The directory, as it changes here or in another tab.
 *
 * @type {import("svelte/store").Readable<WalletDirectory>}
 */
export const walletDirectory = readable(readDirectory(), (set) => {
  /** @param {StorageEvent} event */
  const onStorage = (event) => {
    if (event.key === KEY || event.key === null) {
      set(readDirectory());
    }
  };

  set(readDirectory());
  listeners.add(set);
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(set);
    window.removeEventListener("storage", onStorage);
  };
});

/** @param {WalletDirectory} directory */
function tell(directory) {
  for (const listener of listeners) {
    listener(directory);
  }
}

/**
 * A change of the directory, alone across tabs: `apply` gets it as kept
 * now, and gives it as it's to be; one that throws writes nothing.
 *
 * @param {(directory: WalletDirectory) => WalletDirectory} apply
 * @returns {Promise<WalletDirectory>}
 */
function change(apply) {
  return /** @type {Promise<WalletDirectory>} */ (
    navigator.locks.request(KEY, () => {
      const next = apply(readDirectory());

      localStorage.setItem(KEY, JSON.stringify(next));
      tell(next);

      return next;
    })
  );
}

/**
 * Keeps what a wallet shows while it's open, and makes it the one the next
 * unlock opens.
 *
 * @param {string} key Its vault ID
 * @param {{ accounts: string[], addresses: string[] }} shown Its profiles'
 *   public accounts, the first its wallet ID, and shielded addresses
 */
export const noteActiveWallet = (key, { accounts, addresses }) =>
  change((directory) => ({
    ...directory,
    active: key,
    wallets: {
      ...directory.wallets,
      [key]: {
        ...(directory.wallets[key] ?? walletOf(null)),
        accounts: accounts.map(String),
        addresses: addresses.map(String),
        walletId: String(accounts[0] ?? ""),
      },
    },
  }));

/**
 * Names a wallet, or gives it its number back with "". `check`, called as
 * the name is about to be written, throws to write nothing.
 *
 * @param {string} key
 * @param {string} name
 * @param {() => void} [check]
 */
export const setWalletName = (key, name, check = () => {}) =>
  change((directory) => {
    check();

    const entry = { ...(directory.wallets[key] ?? walletOf(null)) };
    const next = normalizeWalletName(name);

    delete entry.name;

    return {
      ...directory,
      wallets: {
        ...directory.wallets,
        [key]: next ? { ...entry, name: next } : entry,
      },
    };
  });

/**
 * Names one of a wallet's profiles, or gives it its number back with "".
 * `check`, called as the name is about to be written, throws to write
 * nothing.
 *
 * @param {string} key
 * @param {number} index The profile's
 * @param {string} name
 * @param {() => void} [check]
 */
export const setProfileName = (key, index, name, check = () => {}) =>
  change((directory) => {
    check();

    const entry = { ...(directory.wallets[key] ?? walletOf(null)) };
    const names = Array.from(
      { length: Math.max(entry.profileNames?.length ?? 0, index + 1) },
      (_, i) => (i === index ? name : (entry.profileNames?.[i] ?? ""))
    );
    const profileNames = profileNamesOf(names);

    delete entry.profileNames;

    return {
      ...directory,
      wallets: {
        ...directory.wallets,
        [key]: profileNames ? { ...entry, profileNames } : entry,
      },
    };
  });

/**
 * Keeps the block a wallet made here was made at, which Settings shows.
 *
 * @param {string} key
 * @param {bigint} height
 */
export const setWalletHeight = (key, height) =>
  change((directory) => ({
    ...directory,
    wallets: {
      ...directory.wallets,
      [key]: {
        ...(directory.wallets[key] ?? walletOf(null)),
        height: String(height),
      },
    },
  }));

/**
 * Makes `key` the wallet whose data is kept under the names this device
 * used before it kept more than one: "" for none.
 *
 * @param {string} key
 */
export const setLegacyWallet = (key) =>
  change((directory) => ({ ...directory, legacy: key }));

/**
 * Forgets a removed wallet: its entry, and that it was the open one or the
 * one with the names of before.
 *
 * @param {string} key
 */
export const forgetDirectoryWallet = (key) =>
  change((directory) => {
    const wallets = { ...directory.wallets };

    delete wallets[key];

    return {
      active: directory.active === key ? "" : directory.active,
      legacy: directory.legacy === key ? "" : directory.legacy,
      wallets,
    };
  });

/**
 * One wallet, and nothing of any other: a wallet set up in place of every
 * one here, which keeps its data under the names of before.
 *
 * @param {string} key
 */
export const startDirectory = (key) =>
  change(() => ({ active: key, legacy: key, wallets: {} }));

/** Forgets every wallet, for a reset: one write, which needs no lock. */
export function clearDirectory() {
  localStorage.removeItem(KEY);
  tell(readDirectory());
}
