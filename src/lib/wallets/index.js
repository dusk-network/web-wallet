/**
 * The wallets on this device, as one password unlocks them all: unlocking,
 * switching between them without the password, adding one, removing one,
 * naming one, a new password for all of them, and a lock, each told to the
 * other tabs, which follow.
 */

import { derived, get } from "svelte/store";

import { forgetWalletBridgeRecords } from "$lib/bridge/bridgeRecordKeys";
import { forgetWalletRouteTransfers } from "$lib/bridge/migrationActivity";
import { logout } from "$lib/navigation";
import { settingsStore, walletStore } from "$lib/stores";
import vault, { NOT_HERE, ONLY_WALLET } from "$lib/vault";
import getSeedFromMnemonic from "$lib/wallet/getSeedFromMnemonic";
import profileGeneratorFrom from "$lib/wallet/profileGeneratorFrom";
import { walletCacheFor } from "$lib/wallet-cache";

import {
  forgetDirectoryWallet,
  normalizeWalletName,
  noteActiveWallet,
  readDirectory,
  setLegacyWallet,
  setWalletHeight,
  setWalletName,
  walletDirectory,
  walletLabel,
} from "./directory";
import { profilesOf } from "./profiles";
import { onOtherTabs, tellOtherTabs } from "./tabs";
import { forgetWalletData } from "./walletData";

export { normalizeWalletName, walletDirectory, walletLabel };

/**
 * The open wallet's name, as the switcher shows it, when there's more than
 * one wallet here: what says which wallet a profile or a review is of. ""
 * with one.
 *
 * @type {import("svelte/store").Readable<string>}
 */
export const openWalletName = derived(
  [walletStore, walletDirectory],
  ([{ walletKey, wallets }, directory]) => {
    const open = wallets.find(({ key }) => key === walletKey);

    return wallets.length > 1 && open
      ? walletLabel({ n: open.n, name: directory.wallets[open.key]?.name })
      : "";
  }
);

/** @param {string} mnemonic */
const generatorOf = (mnemonic) =>
  profileGeneratorFrom(getSeedFromMnemonic(mnemonic));

/** @param {Profile[]} profiles */
const shownOf = (profiles) => ({
  accounts: profiles.map((profile) => String(profile.account)),
  addresses: profiles.map((profile) => String(profile.address)),
});

/**
 * Keeps in the directory what the wallet open now shows, and makes it the
 * one the next unlock opens. A wallet without a password has nothing to
 * keep.
 */
export async function noteOpenWallet() {
  const { initialized, profiles, walletKey } = get(walletStore);

  if (initialized && walletKey) {
    await noteActiveWallet(walletKey, shownOf(profiles));
  }
}

/**
 * Forgets the wallets the directory lists that the vault doesn't hold any
 * more, with their data: one removed, or every one replaced by a setup cut
 * short. The wallets the unlock opened stay, v1's included while it's still
 * to move. Nothing while the vault can't be read.
 *
 * @param {string[]} opened The vault IDs of the wallets the unlock opened
 */
async function forgetWalletsGone(opened) {
  const inVault = vault.list();

  if (!inVault) {
    return;
  }

  const kept = new Set([...inVault.map(({ id }) => id), ...opened]);

  for (const [key, shown] of Object.entries(readDirectory().wallets)) {
    if (!kept.has(key)) {
      await forgetWalletData(key, shown);
      await forgetDirectoryWallet(key);
    }
  }
}

/**
 * The data kept as it was before this device kept more than one wallet,
 * for the wallet whose phrase v1 held, as it moves: its own when this
 * device's settings say it's the wallet the device had; nobody's when no
 * other wallet here has them, and then it starts them anew; else another
 * wallet's, which keeps them.
 *
 * @param {string} key
 * @param {ProfileGenerator} generator
 */
async function placeMovedWallet(key, generator) {
  const { legacy } = readDirectory();

  if (legacy === key) {
    return;
  }

  const [first] = await profilesOf(generator);

  if (String(first.address) !== get(settingsStore).userId) {
    if (legacy && vault.list()?.some((wallet) => wallet.id === legacy)) {
      return;
    }

    await walletCacheFor("").clear();
    forgetWalletBridgeRecords("");
    forgetWalletRouteTransfers("");
  }

  await setLegacyWallet(key);
}

/**
 * Unlocks every wallet the password opens, the phrase of earlier versions
 * moved in first, and opens the one open last. A wrong password throws
 * InvalidPasswordError.
 *
 * @param {string} password
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function unlockWallets(password, { signal } = {}) {
  const { fromV1, wallets } = await vault.unlock(password, { signal });
  const opened = [];

  for (const { id, mnemonic, n } of wallets) {
    opened.push({ key: id, n, profileGenerator: await generatorOf(mnemonic) });
  }

  signal?.throwIfAborted();
  await forgetWalletsGone(opened.map(({ key }) => key));

  const moved = opened.find(({ key }) => key === fromV1);

  if (moved) {
    await placeMovedWallet(moved.key, moved.profileGenerator);
  }

  signal?.throwIfAborted();
  await walletStore.open(opened, {
    active: readDirectory().active || fromV1 || undefined,
  });
  await noteOpenWallet();
}

/**
 * Opens another wallet held here, without the password, at one of its
 * profiles, and tells the other tabs; in the wallet open, its profile.
 *
 * @param {string} key
 * @param {number} [profile]
 * @param {{ syncFromBlock?: bigint }} [options]
 */
export async function switchToWallet(key, profile = 0, options = {}) {
  const before = get(walletStore).walletKey;

  await walletStore.switchWallet(key, profile, options);

  if (key !== before) {
    await noteOpenWallet();
    tellOtherTabs({ key, profile, type: "switch" });
  }
}

/**
 * Adds a wallet under the password the wallets here share, and opens it.
 * A phrase that's here already is refused (DUPLICATE_PHRASE), and so is a
 * wrong password. One made here syncs from `syncFrom`, the block it's made
 * at (`height`); one restored, from the block given, or the first.
 *
 * @param {string} mnemonic
 * @param {string} password
 * @param {{ height?: bigint, syncFrom?: bigint }} [options]
 * @returns {Promise<{ id: string, n: number }>}
 */
export async function addWallet(mnemonic, password, { height, syncFrom } = {}) {
  const held = get(walletStore).wallets.map(({ key }) => key);
  const wallet = await vault.add(mnemonic, password, { held });

  walletStore.holdWallet({
    key: wallet.id,
    n: wallet.n,
    profileGenerator: await generatorOf(mnemonic),
  });

  if (height !== undefined) {
    await setWalletHeight(wallet.id, height);
  }

  await switchToWallet(wallet.id, 0, { syncFromBlock: syncFrom });

  return wallet;
}

/**
 * What a held wallet's data is kept by: its profiles' public accounts and
 * shielded addresses, from its phrase and as it last showed them.
 *
 * @param {string} key
 * @param {ProfileGenerator} generator
 */
async function keptBy(key, generator) {
  const shown = readDirectory().wallets[key];
  const fromPhrase = shownOf(await profilesOf(generator));

  /** @param {"accounts" | "addresses"} what */
  const all = (what) => [
    ...new Set([...fromPhrase[what], ...(shown?.[what] ?? [])]),
  ];

  return { accounts: all("accounts"), addresses: all("addresses") };
}

/**
 * Another wallet than `key` opened, as `key` goes: on failing, they all
 * lock, as none may stay open on a wallet the vault doesn't hold.
 *
 * @param {string} key
 * @param {Array<{ key: string }>} wallets
 */
async function openAnotherThan(key, wallets) {
  const next = /** @type {{ key: string }} */ (
    wallets.find((wallet) => wallet.key !== key)
  );

  try {
    await switchToWallet(next.key);
  } catch (error) {
    await lockWallets();
    throw error;
  }
}

/**
 * Removes one wallet with the password: its phrase, then its data. The
 * open one goes after another opens. The others stay as they are.
 *
 * @param {string} key
 * @param {string} password
 */
export async function removeWallet(key, password) {
  const { walletKey, wallets } = get(walletStore);
  const held = walletStore.heldWallet(key);

  if (!held || wallets.length < 2) {
    throw new Error(held ? ONLY_WALLET : NOT_HERE);
  }

  const data = await keptBy(key, held.profileGenerator);

  // The vault first: a wrong password changes nothing.
  await vault.remove(key, password);

  if (key === walletKey) {
    await openAnotherThan(key, wallets);
  }

  walletStore.releaseWallet(key);
  await forgetWalletData(key, data);
  await forgetDirectoryWallet(key);
  tellOtherTabs({ type: "wallets" });
}

/**
 * Names a wallet, only on this device, or gives it its number back with "".
 *
 * @param {string} key
 * @param {string} name
 */
export const renameWallet = (key, name) => setWalletName(key, name);

/**
 * A new password for every wallet here: the current one must open each
 * wallet open in this tab. The other tabs lock.
 *
 * @param {string} password
 * @param {string} newPassword
 */
export async function changeWalletPassword(password, newPassword) {
  const held = get(walletStore).wallets.map(({ key }) => key);

  await vault.changePassword(password, newPassword, { held });
  tellOtherTabs({ type: "password" });
}

/** Locks every wallet, here and in the other tabs. */
export function lockWallets() {
  tellOtherTabs({ type: "lock" });

  return logout(false);
}

/**
 * The wallet another tab opened, opened here too, without the password; a
 * tab that doesn't hold it (one added since it unlocked) locks.
 *
 * @param {string} key
 * @param {number} profile
 */
async function follow(key, profile) {
  if (key === get(walletStore).walletKey) {
    return;
  }

  if (!walletStore.heldWallet(key)) {
    await logout(false);

    return;
  }

  try {
    await walletStore.switchWallet(key, profile);
  } catch {
    await logout(false);
  }
}

/**
 * The wallets the vault holds now, after a removal in another tab: the ones
 * it doesn't hold any more are let go here, the open one too, after the
 * one the other tab opened opens.
 */
async function followWallets() {
  const inVault = vault.list();

  if (!inVault) {
    return;
  }

  for (const { key } of get(walletStore).wallets) {
    if (!inVault.some((wallet) => wallet.id === key)) {
      if (key === get(walletStore).walletKey) {
        await follow(readDirectory().active, 0);
      }

      if (get(walletStore).initialized) {
        walletStore.releaseWallet(key);
      }
    }
  }
}

/**
 * @param {import("./tabs").TabEvent} event
 */
async function followTab(event) {
  if (!get(walletStore).initialized) {
    return;
  }

  if (event.type === "lock" || event.type === "password") {
    await logout(false);
  } else if (event.type === "switch") {
    await follow(event.key, event.profile);
  } else {
    await followWallets();
  }
}

/**
 * Follows what the other tabs do with the wallets, one event at a time: a
 * switch, a removal, a new password or a lock.
 *
 * @returns {() => void} Stops following
 */
export function followOtherTabs() {
  let queue = Promise.resolve();

  return onOtherTabs((event) => {
    queue = queue.then(() => followTab(event)).catch(() => {});
  });
}
