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
    return navigator.locks.request(storeKey, () => {
      localStorage.removeItem(storeKey);
    });
  },

  /**
   * Replace only the record that was read before migration's async work.
   * All login writes share this lock: storage events alone arrive too late.
   *
   * @param {WalletEncryptInfo} expected
   * @param {WalletEncryptInfo} info
   * @param {AbortSignal} [signal]
   * @returns {Promise<boolean>}
   */
  replace(expected, info, signal) {
    return navigator.locks.request(storeKey, { signal }, () => {
      signal?.throwIfAborted();
      const current = loginInfoStorage.get();
      if (
        current === null ||
        toStorageString(current) !== toStorageString(expected)
      ) {
        return false;
      }
      localStorage.setItem(storeKey, toStorageString(info));
      return true;
    });
  },

  /**
   * An async producer runs under the lock so a later reset wins even while
   * a new password's encryption is pending.
   * ponytail: reset waits for encryption; use a persisted revision if resets
   * must preempt a suspended writer.
   *
   * @param {WalletEncryptInfo | (() => Promise<WalletEncryptInfo>)} info
   */
  set(info) {
    return navigator.locks.request(storeKey, async () => {
      const value = typeof info === "function" ? await info() : info;
      localStorage.setItem(storeKey, toStorageString(value));
    });
  },
};

export default loginInfoStorage;
