import { get, writable } from "svelte/store";
import { networkStore, walletStore } from "$lib/stores";
import { followTransaction } from "$lib/transactions";
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

/**
 * How long a read along with the balances may hold them up: past it, they
 * show without it.
 */
const ALONG_TIMEOUT_MS = 5_000;

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
 * The reads of what's held, of its own or along the balances, in the order
 * they began, and the last of them that showed: one shows only where none
 * begun after it did, so an older answer never takes a newer one's place,
 * whichever comes back last.
 */
let begun = 0;
let shown = 0;

/**
 * Whether a read's answer can show, by when it began; once it does, none
 * begun before it can.
 *
 * @param {number} order
 */
function mayShow(order) {
  if (order <= shown) {
    return false;
  }

  shown = order;

  return true;
}

/**
 * What `account` has with Sozu, read within `timeout` milliseconds.
 *
 * @param {string} account
 * @param {SozuContracts} contracts
 * @param {string} nodeUrl
 * @param {number} timeout
 * @returns {Promise<SozuStatus>}
 */
function statusOf(account, contracts, nodeUrl, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  return readSozuStatus({
    account,
    contracts,
    nodeUrl,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

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
  const order = (begun += 1);
  const isCurrent = () => current?.promise === promise;
  const promise = statusOf(account, contracts, nodeUrl, READ_TIMEOUT_MS).then(
    (status) => {
      if (!isCurrent()) {
        return;
      }

      // One begun after it showed already: it's done, with nothing to show.
      store.update((state) =>
        mayShow(order)
          ? { account, available: true, error: null, loading: false, status }
          : { ...state, loading: false }
      );
    },
    (error) => {
      if (isCurrent()) {
        store.update((state) => ({
          ...state,
          ...(order > shown
            ? {
                error:
                  error instanceof Error ? error : new Error(String(error)),
              }
            : {}),
          loading: false,
        }));
      }
    }
  );

  return promise;
}

/**
 * What's held with Sozu, read again each time the balances are, for an
 * account whose position shows, and shown with them: Home counts the two
 * together, so what a stake or an unstake moved between them is never
 * counted twice, or not at all. A read that fails, or takes too long, leaves
 * what showed.
 *
 * @param {Profile} profile
 * @returns {Promise<(() => void) | null>}
 */
async function readAlong(profile) {
  const account = String(profile.account);
  const contracts = sozuContractsFor(get(networkStore).net);
  const showing = get(store);

  if (!contracts || showing.account !== account || !showing.status) {
    return null;
  }

  const order = (begun += 1);
  const status = await statusOf(
    account,
    contracts,
    nodeBaseUrl(),
    ALONG_TIMEOUT_MS
  ).catch(() => null);

  // Shown with the balances, unless one begun after it showed already: a
  // read of its own under way still says it's loading.
  return status
    ? () => {
        if (get(store).account === account && mayShow(order)) {
          store.update((state) => ({
            ...state,
            account,
            available: true,
            error: null,
            status,
          }));
        }
      }
    : null;
}

walletStore.readWithBalances?.(readAlong);

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
 * Reads again once a stake's or an unstake's block is final, wherever the
 * user has gone by then, so that Home and Unstake show what it changed: with
 * the balances (`readAlong`), shown together, as what it moved between them
 * would otherwise count twice, or not at all.
 *
 * @param {string} hash
 * @returns {Promise<void>}
 */
function readAfter(hash) {
  const refresh = () => walletStore.refreshBalance();

  return followTransaction(hash).then(refresh, refresh);
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

/** Forgets what was read, as on a lock or a reset: no read under way shows. */
function reset() {
  current = null;
  shown = begun;
  store.set(initialState);
}

/** @type {import("svelte/store").Readable<SozuState> & { check: typeof check, load: typeof load, readAfter: typeof readAfter, reset: typeof reset }} */
export default {
  check,
  load,
  readAfter,
  reset,
  subscribe: store.subscribe,
};
