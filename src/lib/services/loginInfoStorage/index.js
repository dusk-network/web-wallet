import { base64ToBytes, bytesToBase64 } from "$lib/dusk/base64";

const storeKey = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
const decode = /** @type {(value: string) => Uint8Array<ArrayBuffer>} */ (
  base64ToBytes
);

/** @param {string | null} value */
const fromStorageString = (value) => {
  if (value === null) {
    return null;
  }

  const { data, iv, salt, version } = JSON.parse(value);

  return {
    data: decode(data),
    iv: decode(iv),
    salt: decode(salt),
    ...(version === undefined ? {} : { version }),
  };
};

/** @param {WalletEncryptInfo} info */
const toStorageString = ({ data, iv, salt, version }) =>
  JSON.stringify({
    data: bytesToBase64(data),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    ...(version === undefined ? {} : { version }),
  });

const loginInfoStorage = {
  /** @returns {WalletEncryptInfo | null} */
  get() {
    return fromStorageString(localStorage.getItem(storeKey));
  },

  remove() {
    localStorage.removeItem(storeKey);
  },

  /** @param {WalletEncryptInfo} info */
  set(info) {
    localStorage.setItem(storeKey, toStorageString(info));
  },
};

export default loginInfoStorage;
