import { get } from "svelte/store";

import { keepOnlyContactsOf } from "$lib/contacts";
import { settingsStore, walletStore } from "$lib/stores";

import getSeedFromMnemonic from "./getSeedFromMnemonic";
import profileGeneratorFrom from "./profileGeneratorFrom";

/**
 * Starts a wallet restored or made here. Of the contacts on this device it
 * keeps only its own: those kept in plain text before stay only when it's
 * the wallet this device had.
 *
 * @param {string} mnemonic
 * @param {bigint} [syncFrom]
 */
async function initializeWallet(mnemonic, syncFrom) {
  const knownWallet = get(settingsStore).userId;

  settingsStore.reset();

  const profileGenerator = await profileGeneratorFrom(
    getSeedFromMnemonic(mnemonic)
  );
  const firstProfile = await profileGenerator.default;

  await keepOnlyContactsOf(String(firstProfile.account), {
    plain: knownWallet !== "" && knownWallet === String(firstProfile.address),
  });

  walletStore.clearLocalDataAndInit(profileGenerator, syncFrom);
}

export default initializeWallet;
