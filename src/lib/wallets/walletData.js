/**
 * What this device keeps of each wallet besides its phrase: its cache of
 * notes and balances, its bridge transfers and migrations, its contacts,
 * its history and its names. Each wallet's is its own, by the ending of
 * its names ($lib/wallets/dataNames) or by its accounts, so that one
 * wallet's never shows in another, and a wallet removed takes its own
 * alone.
 */

import { forgetWalletActivity } from "$lib/activity/activityStore";
import { forgetWalletBridgeRecords } from "$lib/bridge/bridgeRecordKeys";
import {
  forgetWalletRouteTransfers,
  hydrateMigrations,
} from "$lib/bridge/migrationActivity";
import { forgetContactsOf } from "$lib/contacts";
import { forgetVerifiedNamesOf } from "$lib/dusk-domains/verifiedNames";
import {
  forgetOtherWalletCaches,
  forgetWalletCache,
  walletCacheFor,
} from "$lib/wallet-cache";

import {
  endEveryWallet,
  endWallet,
  suffixOf,
  useWalletDataSuffix,
} from "./dataNames";
import { readDirectory } from "./directory";

/**
 * The ending of a wallet's names, as the directory says now.
 *
 * @param {string} key Its vault ID
 */
const suffixFor = (key) => suffixOf(key, readDirectory().legacy);

/**
 * Makes the names the wallet `key`'s, as it opens, and reads its kept
 * migrations again. Its bridge transfers are read as Bridge shows them.
 *
 * @param {string} key Its vault ID: "" for a wallet without a password
 */
export function useWalletData(key) {
  useWalletDataSuffix(suffixFor(key), key);
  hydrateMigrations();
}

/**
 * Forgets a removed wallet's data, and nothing of another's: its cache,
 * bridge transfers, migrations, contacts, history and names. Every part is
 * tried; one that can't go stays where no other wallet reads it.
 *
 * @param {string} key Its vault ID
 * @param {{ accounts: string[], addresses: string[] }} wallet Its profiles'
 *   public accounts, the first of them its contacts' place, and shielded
 *   addresses
 * @returns {Promise<boolean>} Whether all of it went
 */
export async function forgetWalletData(key, { accounts, addresses }) {
  const suffix = suffixFor(key);

  // Its time here ends first: work begun before writes nothing more of it.
  endWallet(key);
  const results = await Promise.allSettled([
    forgetWalletCache(suffix),
    Promise.resolve().then(() => {
      forgetWalletBridgeRecords(suffix);
      forgetWalletRouteTransfers(suffix);
      forgetVerifiedNamesOf(accounts);
    }),
    accounts[0] ? forgetContactsOf(accounts[0]) : Promise.resolve(),
    forgetWalletActivity({ accounts, addresses }),
  ]);

  return results.every((result) => result.status === "fulfilled");
}

/**
 * Forgets every wallet's own data but the names of before's, as a reset or
 * a wallet set up in place of every one here: their caches, bridge
 * transfers and migrations. Their contacts and history go with the ones
 * of before.
 *
 * @returns {Promise<void>}
 */
export async function forgetOtherWalletsData() {
  const { legacy, wallets } = readDirectory();

  // Every wallet's time here ends first: work begun before writes nothing.
  endEveryWallet();

  const suffixes = Object.keys(wallets)
    .map((key) => suffixOf(key, legacy))
    .filter(Boolean);

  for (const suffix of suffixes) {
    forgetWalletBridgeRecords(suffix);
    forgetWalletRouteTransfers(suffix);
  }

  await forgetOtherWalletCaches(suffixes);
}

/**
 * Forgets every wallet's own data, as a reset does: the one with the names
 * of before too.
 *
 * @returns {Promise<void>}
 */
export async function forgetEveryWalletData() {
  await forgetOtherWalletsData();
  await walletCacheFor("").clear();
  forgetWalletBridgeRecords("");
  forgetWalletRouteTransfers("");
}
