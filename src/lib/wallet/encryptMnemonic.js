import encryptBuffer from "./encryptBuffer";
import {
  CURRENT_PBKDF2_ITERATIONS,
  CURRENT_WALLET_ENCRYPTION_VERSION,
} from "./walletEncryption";

/**
 * @param {string} mnemonic
 * @param {string} pwd
 * @returns {Promise<WalletEncryptInfo>}
 */
const encryptMnemonic = async (mnemonic, pwd) => ({
  ...(await encryptBuffer(
    new TextEncoder().encode(mnemonic),
    pwd,
    CURRENT_PBKDF2_ITERATIONS
  )),
  version: CURRENT_WALLET_ENCRYPTION_VERSION,
});

export default encryptMnemonic;
