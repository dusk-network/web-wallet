import decryptBuffer from "./decryptBuffer";
import { getWalletEncryptionIterations } from "./walletEncryption";

/**
 * @param {WalletEncryptInfo} encryptInfo
 * @param {string} pwd
 * @returns {Promise<string>}
 */
const decryptMnemonic = async (encryptInfo, pwd) =>
  new TextDecoder().decode(
    await decryptBuffer(
      encryptInfo,
      pwd,
      getWalletEncryptionIterations(encryptInfo.version)
    )
  );

export default decryptMnemonic;
