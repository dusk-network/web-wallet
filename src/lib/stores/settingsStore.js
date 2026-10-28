import { writable } from "svelte/store";
import { browser } from "$app/environment";

// =========================
// --- Utilities ---
// =========================

export const serializeProperty = (/** @type {any} */ value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}n` : v));

export const deserializeProperty = (/** @type {string} */ value) =>
  JSON.parse(value, (_, v) =>
    typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v
  );

// =========================
// --- End of Utilities ---
// =========================

const browserDefaults = browser
  ? {
      darkMode: window.matchMedia("(prefers-color-scheme: dark)").matches,
      language: navigator.language,
    }
  : {
      darkMode: false,
      language: "en",
    };

/**
 * The one gas limit used before each operation had its own default.
 */
const LEGACY_DEFAULT_GAS_LIMIT = 100_000_000n;

/** Minutes without activity before a wallet with a password locks. */
export const AUTO_LOCK_MINUTES = Object.freeze([5, 15]);

/** @type {SettingsStoreContent} */
const initialState = {
  ...browserDefaults,

  // Minutes without activity before a wallet with a password locks, or 0
  // to never lock it.
  autoLockMinutes: 15,
  currency: "USD",

  // A gas limit and a gas price the user set for every operation, or `null`
  // for each operation's own default limit and the node's price: see
  // `getGasSettings`. The user sets both or neither.
  customGasLimit: null,
  customGasPrice: null,
  dashboardTransactionLimit: 5,

  // The gas limit and price of older versions, kept so that they can still
  // read these settings.
  gasLimit: LEGACY_DEFAULT_GAS_LIMIT,
  gasPrice: BigInt(import.meta.env.VITE_GAS_PRICE_DEFAULT ?? 1),
  hideBalances: false,
  hideStakingNotice: false,
  userId: "",
  walletCreationBlockHeight: 0n,
};

/**
 * Settings from older versions have no custom gas limit: their gas limit
 * becomes one, unless it is the old default.
 *
 * @param {any} settings The stored settings, possibly from an older version.
 * @returns {any}
 */
const migrateGasLimit = (settings) =>
  "customGasLimit" in settings
    ? settings
    : {
        ...settings,
        customGasLimit:
          typeof settings.gasLimit === "bigint" &&
          settings.gasLimit !== LEGACY_DEFAULT_GAS_LIMIT
            ? settings.gasLimit
            : null,
      };

/**
 * Settings from older versions have no custom gas price. With a custom gas
 * limit, their gas price becomes the custom one, as the user sets both or
 * neither; without one, the node's price replaces it.
 *
 * @param {any} settings The stored settings, possibly from an older version.
 * @returns {any}
 */
const migrateGasPrice = (settings) =>
  "customGasPrice" in settings
    ? settings
    : {
        ...settings,
        customGasPrice:
          settings.customGasLimit !== null &&
          typeof settings.gasPrice === "bigint"
            ? settings.gasPrice
            : null,
      };

/**
 * @param {any} settings The stored settings, possibly from an older version.
 * @returns {SettingsStoreContent}
 */
const migrate = (settings) => {
  const migrated = migrateGasPrice(migrateGasLimit(settings));

  return AUTO_LOCK_MINUTES.includes(migrated.autoLockMinutes) ||
    migrated.autoLockMinutes === 0
    ? migrated
    : { ...migrated, autoLockMinutes: initialState.autoLockMinutes };
};

const createPersistedStore = (
  /** @type {string} */ key,
  /** @type {SettingsStoreContent} */ initialValue
) => {
  const load = () => {
    if (!browser) {
      return initialValue;
    }
    const storedValue = localStorage.getItem(key);
    return storedValue
      ? migrate(deserializeProperty(storedValue))
      : initialValue;
  };

  const store = writable(load());

  if (browser) {
    store.subscribe((value) => {
      localStorage.setItem(key, serializeProperty(value));
    });
  }

  return store;
};

const settingsStore = createPersistedStore(
  `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`,
  initialState
);

const { set, subscribe, update } = settingsStore;

// Reset store to initial state
const reset = () => set(initialState);

// Resets only gas settings to their defaults.
const resetGasSettings = () =>
  update((current) => ({
    ...current,
    customGasLimit: initialState.customGasLimit,
    customGasPrice: initialState.customGasPrice,
    gasPrice: initialState.gasPrice,
  }));

/** @type {SettingsStore} */
export default {
  reset,
  resetGasSettings,
  set,
  subscribe,
  update,
};
