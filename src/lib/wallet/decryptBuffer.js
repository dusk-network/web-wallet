import getDerivedKey from "./getDerivedKey";

/**
 * @param {WalletEncryptInfo} encryptInfo
 * @param {string} pwd
 * @param {number} [iterations]
 * @returns {Promise<ArrayBuffer>}
 */
async function decryptBuffer(encryptInfo, pwd, iterations) {
  const { data, iv, salt } = encryptInfo;
  const key = await getDerivedKey(pwd, salt, iterations);

  return await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, key, data);
}

export default decryptBuffer;
