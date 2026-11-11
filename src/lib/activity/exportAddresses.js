/**
 * The EVM addresses added to a profile's export as the person's, kept on this
 * device for that profile, as its requests are: the same period gives the
 * same file after a lock as before it. A migration's gas there is the
 * person's only from an address of theirs (`makeExport`).
 *
 * Each wallet's are kept under its own name ($lib/wallets/dataNames), by its
 * profiles' public accounts.
 *
 * `${APP_KEY}-export-evm`: { [public account]: ["0x…", …] }
 */

import { writable } from "svelte/store";

import { walletDataScope } from "$lib/wallets/dataNames";
import {
  changeRecords,
  openRecords,
  walletRecords,
} from "$lib/wallets/walletRecords";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-export-evm`;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

/** @type {import("svelte/store").Writable<Record<string, string[]>>} */
const added = writable({});

const records = walletRecords({
  name: KEY,
  /** @returns {Record<string, string[]>} */
  read(scope) {
    try {
      const kept = JSON.parse(localStorage.getItem(scope.name(KEY)) ?? "null");

      return kept && typeof kept === "object" && !Array.isArray(kept)
        ? Object.fromEntries(
            Object.entries(kept)
              .map(([account, addresses]) => [
                account,
                Array.isArray(addresses)
                  ? addresses.filter(
                      (address) =>
                        typeof address === "string" && EVM_ADDRESS.test(address)
                    )
                  : [],
              ])
              .filter(([, addresses]) => addresses.length)
          )
        : {};
    } catch {
      return {};
    }
  },
  store: added,
});

/** The open wallet's export addresses, by its profiles' public accounts. */
export const exportAddresses = { subscribe: added.subscribe };

/** Shows the wallet's export addresses, as it opens. */
export const hydrateExportAddresses = () => openRecords(records);

/**
 * Forgets one wallet's export addresses, as it's removed, by the ending of
 * its names.
 *
 * @param {string} suffix
 */
export function forgetWalletExportAddresses(suffix) {
  try {
    localStorage.removeItem(`${KEY}${suffix}`);
  } catch {
    // Nothing is kept where storage can't be read.
  }
}

/**
 * Keeps an EVM address of the person's for a profile's export, once.
 *
 * @param {string} account The profile's public account
 * @param {string} address
 */
export function addExportAddress(account, address) {
  if (!account || !EVM_ADDRESS.test(address)) {
    return;
  }

  changeRecords(records, walletDataScope(), (all) => {
    const own = all[account] ?? [];

    return own.some((kept) => kept.toLowerCase() === address.toLowerCase())
      ? all
      : { ...all, [account]: [...own, address] };
  });
}

/**
 * Takes an EVM address off a profile's export.
 *
 * @param {string} account The profile's public account
 * @param {string} address
 */
export function removeExportAddress(account, address) {
  changeRecords(records, walletDataScope(), (all) => {
    const left = (all[account] ?? []).filter(
      (kept) => kept.toLowerCase() !== address.toLowerCase()
    );
    const others = Object.fromEntries(
      Object.entries(all).filter(([owner]) => owner !== account)
    );

    return left.length ? { ...others, [account]: left } : others;
  });
}
