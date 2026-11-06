/**
 * What the wallets here call their profiles' public accounts and shielded
 * addresses, as a review's From line calls the one it's from: "Wallet 2 ·
 * Profile 1", or the name the profile was given here, with the `.dusk` name
 * last verified for the profile's account after it, and ", shielded" after
 * its shielded address; without the wallet's name while there's only one.
 * The open wallet's profiles as it has them, another's as it last showed
 * them, as the profile switcher lists them: nothing is derived from another
 * wallet's phrase for this.
 */

import { derived } from "svelte/store";

import { getVerifiedName } from "$lib/dusk-domains/verifiedNames";
import { networkStore, walletStore } from "$lib/stores";

import { profileNameAt, walletDirectory, walletLabel } from "./directory";

/**
 * The wallets here, as the profile switcher lists them: each with its
 * profiles' accounts, addresses and names, and its own name where there's
 * more than one.
 *
 * @param {WalletStoreContent} state
 * @param {{ wallets: Record<string, { accounts: string[], addresses: string[], name?: string, profileNames?: string[] }> }} directory
 */
function walletsHere({ profiles, walletKey, wallets }, directory) {
  const open = {
    accounts: profiles.map((profile) => String(profile.account)),
    addresses: profiles.map((profile) => String(profile.address)),
    profileNames: directory.wallets[walletKey]?.profileNames,
  };

  return wallets.length
    ? wallets.map(({ key, n }) => ({
        ...(key === walletKey
          ? open
          : (directory.wallets[key] ?? { accounts: [], addresses: [] })),
        wallet:
          wallets.length > 1
            ? walletLabel({ n, name: directory.wallets[key]?.name })
            : "",
      }))
    : [{ ...open, wallet: "" }];
}

/**
 * The profiles here, of every wallet, by the name each goes by, with its
 * public account: names no contact takes, as a review would read one as the
 * profile.
 *
 * @type {import("svelte/store").Readable<{ address: string, name: string }[]>}
 */
export const profilesHere = derived(
  [walletStore, walletDirectory],
  ([state, directory]) =>
    walletsHere(state, directory).flatMap(({ accounts, profileNames }) =>
      accounts.map((address, i) => ({
        address,
        name: profileNameAt(profileNames, i),
      }))
    )
);

/** @type {import("svelte/store").Readable<Map<string, string>>} */
const walletAccountNames = derived(
  [walletStore, walletDirectory, networkStore],
  ([state, directory, { networkName }]) => {
    /** @type {Map<string, string>} */
    const names = new Map();

    for (const { accounts, addresses, profileNames, wallet } of walletsHere(
      state,
      directory
    )) {
      accounts.forEach((account, i) => {
        const label = [
          wallet,
          profileNameAt(profileNames, i),
          getVerifiedName(networkName, account),
        ]
          .filter(Boolean)
          .join(" · ");

        if (account) {
          names.set(account, label);
        }

        if (addresses[i]) {
          names.set(addresses[i], `${label}, shielded`);
        }
      });
    }

    return names;
  }
);

export default walletAccountNames;
