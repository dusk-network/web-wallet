import { get } from "svelte/store";

import { forgetBridgeRecords } from "$lib/bridge/forgetBridgeRecords";
import { keepOnlyContactsOf } from "$lib/contacts";
import { settingsStore, walletStore } from "$lib/stores";

import getSeedFromMnemonic from "./getSeedFromMnemonic";
import profileGeneratorFrom from "./profileGeneratorFrom";

/**
 * Starts a wallet restored or made here. Of the contacts on this device it
 * keeps only its own: those kept in plain text before stay only when it's
 * the wallet this device had. So do the bridge's transfers kept here.
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
  const isKnownWallet =
    knownWallet !== "" && knownWallet === String(firstProfile.address);

  await keepOnlyContactsOf(String(firstProfile.account), {
    plain: isKnownWallet,
  });

  if (!isKnownWallet) {
    forgetBridgeRecords();
  }

  walletStore.clearLocalDataAndInit(profileGenerator, syncFrom);
}

export default initializeWallet;
