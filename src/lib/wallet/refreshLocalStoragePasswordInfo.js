import vault from "$lib/vault";

/**
 * The password setup's step: the wallet's phrase sealed under the password,
 * in place of every phrase here, or with no password, none kept at all.
 *
 * @param {string[]} mnemonicPhrase
 * @param {string} password
 */
async function refreshLocalStoragePasswordInfo(mnemonicPhrase, password) {
  if (password.length === 0) {
    await vault.clear();
  } else {
    await vault.setUp(mnemonicPhrase.join(" "), password);
  }
}

export default refreshLocalStoragePasswordInfo;
