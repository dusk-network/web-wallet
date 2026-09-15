import loginInfoStorage from "$lib/services/loginInfoStorage";

import decryptMnemonic from "./decryptMnemonic";
import encryptMnemonic from "./encryptMnemonic";

/**
 * @param {WalletEncryptInfo} loginInfo
 * @param {string} pwd
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
async function migrateLoginInfo(loginInfo, pwd, signal) {
  if (loginInfo.version !== undefined) {
    return false;
  }

  const mnemonic = await decryptMnemonic(loginInfo, pwd);
  const migratedLoginInfo = await encryptMnemonic(mnemonic, pwd);

  return loginInfoStorage.replace(loginInfo, migratedLoginInfo, signal);
}

export default migrateLoginInfo;
