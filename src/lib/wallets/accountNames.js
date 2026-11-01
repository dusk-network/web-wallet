/**
 * What the wallets here call their profiles' public accounts and shielded
 * addresses, as a review's From line calls the one it's from: "Wallet 2 ·
 * Profile 1", with the `.dusk` name last verified for the profile's account
 * after it, and ", shielded" after its shielded address; without the
 * wallet's name while there's only one. The open wallet's profiles as it
 * has them, another's as it last showed them, as the profile switcher
 * lists them: nothing is derived from another wallet's phrase for this.
 */

import { derived } from "svelte/store";

import { getVerifiedName } from "$lib/dusk-domains/verifiedNames";
import { networkStore, walletStore } from "$lib/stores";

import { walletDirectory, walletLabel } from "./directory";

/** @type {import("svelte/store").Readable<Map<string, string>>} */
const walletAccountNames = derived(
  [walletStore, walletDirectory, networkStore],
  ([{ profiles, walletKey, wallets }, directory, { networkName }]) => {
    /** @type {Map<string, string>} */
    const names = new Map();
    const open = {
      accounts: profiles.map((profile) => String(profile.account)),
      addresses: profiles.map((profile) => String(profile.address)),
    };
    const shown = wallets.length
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

    for (const { accounts, addresses, wallet } of shown) {
      accounts.forEach((account, i) => {
        const label = [
          wallet,
          `Profile ${i + 1}`,
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
