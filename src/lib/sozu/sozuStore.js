import { get, writable } from "svelte/store";
import { networkStore, walletStore } from "$lib/stores";
import { nodeBaseUrl } from "$lib/url";

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
  const contracts = sozuContractsFor(get(networkStore).net);
  const nodeUrl = nodeBaseUrl();
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

/**
 * Reads Sozu again now, as before a stake is sent: the status read, or null
 * when it couldn't be read, though the store keeps showing the last one.
 *
 * @returns {Promise<SozuStatus | null>}
 */
async function check() {
  await load({ force: true });
  await lastRead();

  const { error, status } = get(store);

  return error ? null : status;
}

/**
 * Waits for the last read: a newer one can take an earlier one's place.
 *
 * @returns {Promise<void>}
 */
async function lastRead() {
  const entry = current;

  await entry?.promise;

  if (current && current !== entry) {
    await lastRead();
  }
}

/** Forgets what was read, as on a lock or a reset. */
function reset() {
  current = null;
  store.set(initialState);
}

/** @type {import("svelte/store").Readable<SozuState> & { check: typeof check, load: typeof load, reset: typeof reset }} */
export default {
  check,
  load,
  reset,
  subscribe: store.subscribe,
};
