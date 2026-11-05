import { get } from "svelte/store";

import { forgetBridgeRecords } from "$lib/bridge/forgetBridgeRecords";
import { keepOnlyContactsOf } from "$lib/contacts";
import { setSendPasswordLimit } from "$lib/security/sendPassword";
import { settingsStore, walletStore } from "$lib/stores";
import vault from "$lib/vault";
import { startIncarnation } from "$lib/wallets/dataNames";
import { startDirectory } from "$lib/wallets/directory";
import { forgetOtherWalletsData } from "$lib/wallets/walletData";

import getSeedFromMnemonic from "./getSeedFromMnemonic";
import profileGeneratorFrom from "./profileGeneratorFrom";

/**
 * Starts a wallet restored or made here, in place of every wallet on this
 * device. Of the contacts here it keeps only its own: those kept in plain
 * text before stay only when it's the wallet this device had. So do the
 * bridge's transfers kept here. Every other wallet's data goes. It resolves
 * once the wallet is open, before its first sync ends.
 *
 * @param {string} mnemonic
 * @param {bigint} [syncFrom]
 */
async function initializeWallet(mnemonic, syncFrom) {
  const knownWallet = get(settingsStore).userId;

  settingsStore.reset();
  setSendPasswordLimit(null);

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

  // The one wallet here now: the vault's, set up with the password, or none
  // without one. It keeps its data under the names of before.
  await forgetOtherWalletsData();

  const [wallet] = vault.list() ?? [];
  const key = wallet?.id ?? "";

  // Its incarnation first: where it can't be kept, it isn't set up.
  startIncarnation(key);
  await startDirectory(key);

  await walletStore.clearLocalDataAndInit(profileGenerator, syncFrom, {
    key,
    n: 1,
  });
}

export default initializeWallet;
