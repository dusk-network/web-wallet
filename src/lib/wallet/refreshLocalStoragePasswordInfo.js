import loginInfoStorage from "$lib/services/loginInfoStorage";
import { encryptMnemonic } from "$lib/wallet";

/**
 * @param {string[]} mnemonicPhrase
 * @param {string} password
 */
async function refreshLocalStoragePasswordInfo(mnemonicPhrase, password) {
  if (password.length === 0) {
    await loginInfoStorage.remove();
  } else {
    await loginInfoStorage.set(() =>
      encryptMnemonic(mnemonicPhrase.join(" "), password)
    );
  }
}

export default refreshLocalStoragePasswordInfo;
