import loginInfoStorage from "$lib/services/loginInfoStorage";

import decryptMnemonic from "./decryptMnemonic";
import encryptMnemonic from "./encryptMnemonic";

/**
 * @param {WalletEncryptInfo} loginInfo
 * @param {string} pwd
 * @returns {Promise<boolean>}
 */
async function migrateLoginInfo(loginInfo, pwd) {
  if (loginInfo.version !== undefined) {
    return false;
  }

  const mnemonic = await decryptMnemonic(loginInfo, pwd);
  const migratedLoginInfo = await encryptMnemonic(mnemonic, pwd);

  loginInfoStorage.set(migratedLoginInfo);

  return true;
}

export default migrateLoginInfo;
