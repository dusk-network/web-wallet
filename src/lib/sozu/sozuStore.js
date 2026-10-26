import { get, writable } from "svelte/store";
import { networkStore, walletStore } from "$lib/stores";
import { makeNodeUrl } from "$lib/url";

import { sozuContractsFor } from "./config";
import { readSozuStatus } from "./status";

/**
 * @typedef {{
 *   account: string,
 *   available: boolean,
 *   error: Error | null,
 *   loading: boolean,
 *   status: SozuStatus | null,
 * }} SozuState
 */

/** How long a read may take before it counts as failed. */
const READ_TIMEOUT_MS = 15_000;

/** @type {SozuState} */
const initialState = {
  account: "",
  available: false,
  error: null,
  loading: false,
  status: null,
};

const store = writable(initialState);

/** @type {{ key: string, promise: Promise<void> } | null} */
let current = null;

/**
 * Reads what `account` has with Sozu into the store, unless a newer read
 * took its place, within READ_TIMEOUT_MS.
 *
 * @param {string} account
 * @param {SozuContracts} contracts
 * @param {string} nodeUrl
 * @returns {Promise<void>}
 */
function read(account, contracts, nodeUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  const isCurrent = () => current?.promise === promise;
  const promise = readSozuStatus({
    account,
    contracts,
    nodeUrl,
    signal: controller.signal,
  })
    .then(
      (status) => {
        if (isCurrent()) {
          store.set({
            account,
            available: true,
            error: null,
            loading: false,
            status,
          });
        }
      },
      (error) => {
        if (isCurrent()) {
          store.update((state) => ({
            ...state,
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false,
          }));
        }
      }
    )
    .finally(() => clearTimeout(timer));

  return promise;
}

/**
 * Reads what the current profile's account has with Sozu, unless a read for
 * it is under way or done; `force` reads again, as after a transaction. The
 * last status stays shown while the account's next read runs.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<void>}
 */
function load({ force = false } = {}) {
  const account = String(get(walletStore).currentProfile?.account ?? "");
  const contracts = sozuContractsFor(get(networkStore).networkName);
  const nodeUrl = makeNodeUrl().origin;
  const key = `${nodeUrl}\n${account}`;

  if (!account || !contracts) {
    current = null;
    store.set({ ...initialState, account });

    return Promise.resolve();
  }

  if (current?.key === key && !force) {
    return current.promise;
  }

  store.update((state) => ({
    account,
    available: true,
    error: null,
    loading: true,
    status: state.account === account ? state.status : null,
  }));

  const entry = { key, promise: read(account, contracts, nodeUrl) };

  current = entry;

  return entry.promise;
}

/** Forgets what was read, as on a lock or a reset. */
function reset() {
  current = null;
  store.set(initialState);
}

/** @type {import("svelte/store").Readable<SozuState> & { load: typeof load, reset: typeof reset }} */
export default {
  load,
  reset,
  subscribe: store.subscribe,
};
