/**
 * The requests a wallet made, kept on this device, with the payment that paid
 * each once one did. What came in for them is `@dusk-network/app-core/requests`'
 * to say (`matchRequests`), for both wallets.
 *
 * Each wallet's are kept under its own name ($lib/wallets/dataNames): at most
 * MAX_REQUESTS, the oldest settled going first, then the oldest.
 *
 * `${APP_KEY}-payment-requests`: [{ at, id, lux, memo, network, paid?, to }],
 * `paid` as { at, hash, lux? }
 */

import { get, writable } from "svelte/store";

import { walletDataScope } from "$lib/wallets/dataNames";
import {
  changeRecords,
  openRecords,
  walletRecords,
} from "$lib/wallets/walletRecords";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-payment-requests`;

/** A small list. */
const MAX_REQUESTS = 50;

/**
 * A request as it's kept: `lux` as a decimal string, null for any amount, and
 * `paid` the payment that paid it.
 *
 * @typedef {import("@dusk-network/app-core/requests").KeptRequest & { network: string }} PaymentRequest
 */

/** @typedef {import("@dusk-network/app-core/requests").RequestMatch} RequestMatch */
/** @typedef {import("@dusk-network/app-core/requests").RequestPayment} RequestPayment */

/** @type {import("svelte/store").Writable<PaymentRequest[]>} */
const requests = writable([]);

/** @param {any} kept */
const isRequest = (kept) =>
  Boolean(kept) &&
  typeof kept === "object" &&
  typeof kept.id === "string" &&
  typeof kept.to === "string" &&
  typeof kept.memo === "string" &&
  typeof kept.network === "string" &&
  typeof kept.at === "number" &&
  (kept.lux === null ||
    (typeof kept.lux === "string" && /^\d+$/.test(kept.lux)));

const records = walletRecords({
  keyOf: (/** @type {PaymentRequest} */ request) => request.id,
  name: KEY,
  /** @returns {PaymentRequest[]} */
  read(scope) {
    try {
      const kept = JSON.parse(localStorage.getItem(scope.name(KEY)) ?? "null");

      return Array.isArray(kept) ? kept.filter(isRequest) : [];
    } catch {
      return [];
    }
  },
  store: requests,
});

/** The open wallet's requests. */
export const requestsStore = { subscribe: requests.subscribe };

/** Shows the wallet's requests, as it opens. */
export const hydrateRequests = () => openRecords(records);

/**
 * Forgets one wallet's requests, as it's removed, by the ending of its names.
 *
 * @param {string} suffix
 */
export function forgetWalletRequests(suffix) {
  try {
    localStorage.removeItem(`${KEY}${suffix}`);
  } catch {
    // Nothing is kept where storage can't be read.
  }
}

/**
 * What goes as the list is full: the oldest settled, then the oldest.
 *
 * @param {PaymentRequest[]} list Newest first
 */
function trimmed(list) {
  const kept = [...list];

  while (kept.length > MAX_REQUESTS) {
    const settled = kept.findLastIndex(({ paid }) => paid);

    kept.splice(settled < 0 ? kept.length - 1 : settled, 1);
  }

  return kept;
}

/**
 * Keeps a request as it leaves the wallet: the same one asked before stays as
 * it is, with the time it was first asked, paid or not, as its link and QR are
 * the same.
 *
 * @param {{ lux: bigint | null, memo: string, network: string, to: string }} asked
 */
export function rememberRequest({ lux, memo, network, to }) {
  const text = lux === null ? null : String(lux);

  changeRecords(records, walletDataScope(), (list) =>
    list.some(
      (kept) =>
        kept.to === to &&
        kept.lux === text &&
        kept.memo === memo &&
        kept.network === network
    )
      ? list
      : trimmed([
          {
            at: Date.now(),
            id: crypto.randomUUID(),
            lux: text,
            memo,
            network,
            to,
          },
          ...list,
        ])
  );
}

/**
 * Takes a request off the list.
 *
 * @param {string} id
 */
export function forgetRequest(id) {
  changeRecords(records, walletDataScope(), (list) =>
    list.filter((kept) => kept.id !== id)
  );
}

/**
 * Keeps what paid each request, with what it paid, for it to stay paid, and
 * that to be said, once its payment is too far back to be read again: also
 * for one kept paid before what it paid was kept with it.
 *
 * @param {Map<string, RequestMatch>} matches
 */
export function keepRequestMatches(matches) {
  /** @param {PaymentRequest} kept */
  const paid = (kept) => {
    const match = matches.get(kept.id);

    if (match?.state !== "paid" || !match.hash || !match.at) {
      return null;
    }

    const lux = match.lux === undefined ? {} : { lux: String(match.lux) };

    if (!kept.paid) {
      return { at: match.at, hash: match.hash, ...lux };
    }

    return !kept.paid.lux && lux.lux && kept.paid.hash === match.hash
      ? { ...kept.paid, ...lux }
      : null;
  };

  // Written only for something new: what shows it reads the list again.
  if (get(requests).some(paid)) {
    changeRecords(records, walletDataScope(), (list) =>
      list.map((kept) => {
        const payment = paid(kept);

        return payment ? { ...kept, paid: payment } : kept;
      })
    );
  }
}
