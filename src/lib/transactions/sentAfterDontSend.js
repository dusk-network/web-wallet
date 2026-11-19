/**
 * The sends that went out after the person chose Don't send, as their
 * transaction, handed to the node before, reached a block all the same
 * ($lib/transactions/handedOverSends): each says so, "Sent after you chose
 * not to send", with the time it landed, in Activity, History and its
 * details, until it's opened once (Lena's and Chen's: "Sent after all"
 * showed for a few seconds, then it was an ordinary Sent row, and the
 * no seemed ignored).
 *
 * Each wallet's are kept under its own name ($lib/wallets/dataNames), by
 * the transaction's hash, lower case: when it landed, in milliseconds.
 *
 * `${APP_KEY}-sent-after-dont-send`: { [hash]: landedAt }
 */

import { get, writable } from "svelte/store";

import { walletDataScope } from "$lib/wallets/dataNames";
import {
  changeRecords,
  openRecords,
  walletRecords,
} from "$lib/wallets/walletRecords";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-sent-after-dont-send`;

const HASH = /^[0-9a-f]{64}$/;

/** @type {import("svelte/store").Writable<Record<string, number>>} */
const marks = writable({});

const records = walletRecords({
  name: KEY,
  /** @returns {Record<string, number>} */
  read(scope) {
    try {
      const kept = JSON.parse(localStorage.getItem(scope.name(KEY)) ?? "null");

      return kept && typeof kept === "object" && !Array.isArray(kept)
        ? Object.fromEntries(
            Object.entries(kept).filter(
              ([hash, at]) => HASH.test(hash) && Number.isFinite(at),
            ),
          )
        : {};
    } catch {
      return {};
    }
  },
  store: marks,
});

/**
 * The open wallet's sends that went out after Don't send, not opened since:
 * when each landed, by its hash.
 */
export const sentAfterDontSend = { subscribe: marks.subscribe };

/** Shows the wallet's, as it opens. */
export const hydrateSentAfterDontSend = () => openRecords(records);

/**
 * A send the person chose not to send went out all the same, in a block of
 * `landedAt`: said so until it's opened, for the wallet it was sent from
 * (`scope`, taken as its follow began).
 *
 * @param {string} hash
 * @param {number} landedAt
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 */
export function markSentAfterDontSend(
  hash,
  landedAt,
  scope = walletDataScope(),
) {
  changeRecords(records, scope, (kept) => ({
    ...kept,
    [String(hash).toLowerCase()]: landedAt,
  }));
}

/**
 * It was opened: from now on it's an ordinary send.
 *
 * @param {string} hash
 */
export function seenSentAfterDontSend(hash) {
  const lower = String(hash).toLowerCase();

  if (!Object.hasOwn(get(marks), lower)) {
    return;
  }

  changeRecords(records, walletDataScope(), (kept) =>
    Object.fromEntries(Object.entries(kept).filter(([each]) => each !== lower)),
  );
}

/**
 * Forgets one wallet's, as it's removed, by the ending of its names.
 *
 * @param {string} suffix
 */
export function forgetWalletSentAfterDontSend(suffix) {
  try {
    localStorage.removeItem(`${KEY}${suffix}`);
  } catch {
    // Nothing was kept.
  }
}
