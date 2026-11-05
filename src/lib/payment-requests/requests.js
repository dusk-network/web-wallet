/**
 * The requests a wallet made, kept on this device, each marked by what came in
 * after it. What came in only ever says what matched: "paid" takes the amount
 * and the memo asked, both, in one payment; anything less is a payment to
 * check, never a request paid.
 *
 * Each wallet's are kept under its own name ($lib/wallets/dataNames): at most
 * MAX_REQUESTS, the oldest settled going first, then the oldest.
 *
 * `${APP_KEY}-payment-requests`: [{ at, id, lux, memo, network, paid?, to }]
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

/** How far a device's clock can be out from a block's: a payment this long before a request can be for it. */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * A request as it's kept: `lux` as a decimal string, null for any amount, and
 * `paid` the payment that matched its amount and memo.
 *
 * @typedef {{
 *   at: number,
 *   id: string,
 *   lux: string | null,
 *   memo: string,
 *   network: string,
 *   paid?: { at: number, hash: string },
 *   to: string,
 * }} PaymentRequest
 */

/**
 * What came in for a request:
 * - "paid": a payment with the amount and the memo asked;
 * - "check": a payment with what `matched` says: not the whole of it, or a
 *   request asking too little to tell;
 * - "waiting": none yet.
 *
 * @typedef {{
 *   at?: number,
 *   hash?: string,
 *   lux?: bigint,
 *   matched?: "amount" | "amount-memo" | "memo",
 *   memo?: string,
 *   state: "check" | "paid" | "waiting",
 * }} RequestMatch
 */

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
 * Keeps a request as it leaves the wallet: the same one still open stays as it
 * is, with the time it was first asked.
 *
 * @param {{ lux: bigint | null, memo: string, network: string, to: string }} asked
 */
export function rememberRequest({ lux, memo, network, to }) {
  const text = lux === null ? null : String(lux);

  changeRecords(records, walletDataScope(), (list) =>
    list.some(
      (kept) =>
        !kept.paid &&
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
 * Keeps what paid each request, for it to stay paid once its payment is too
 * far back to be read again.
 *
 * @param {Map<string, RequestMatch>} matches
 */
export function keepRequestMatches(matches) {
  /** @param {PaymentRequest} kept */
  const paid = (kept) => {
    const match = matches.get(kept.id);

    return match?.state === "paid" && !kept.paid && match.hash && match.at
      ? { at: match.at, hash: match.hash }
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

/** @param {string | null | undefined} memo */
const memoOf = (memo) => (memo ?? "").trim();

/**
 * What a payment has of what a request asked: null for nothing, or for a
 * payment that came before it.
 *
 * @param {PaymentRequest} request
 * @param {ActivityRow} row
 * @returns {"amount" | "amount-memo" | "memo" | null}
 */
function matchOf(request, row) {
  if (
    row.time === null ||
    row.time === undefined ||
    row.time < request.at - CLOCK_SKEW_MS
  ) {
    return null;
  }

  const sameAmount = request.lux !== null && row.value === BigInt(request.lux);
  const sameMemo = request.memo !== "" && memoOf(row.memo) === request.memo;

  return sameAmount && sameMemo
    ? "amount-memo"
    : sameAmount
      ? "amount"
      : sameMemo
        ? "memo"
        : null;
}

/**
 * What came in for each request, by its ID, from the rows read: a payment
 * answers one request, the oldest it matches best, and one that matches the
 * amount and the memo comes before one that matches less.
 *
 * @param {PaymentRequest[]} list
 * @param {ActivityRow[]} rows
 * @returns {Map<string, RequestMatch>}
 */
export function matchRequests(list, rows) {
  /** @type {Map<string, RequestMatch>} */
  const matches = new Map();
  const taken = new Set(list.flatMap(({ paid }) => (paid ? [paid.hash] : [])));
  const incoming = rows
    .filter(
      ({ category, status }) =>
        category === "received" && status !== "failed" && status !== "pending"
    )
    .toSorted((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const oldestFirst = list.toSorted((a, b) => a.at - b.at);

  /**
   * @param {PaymentRequest} request
   * @param {"amount-memo" | "guess"} wanted
   */
  const answer = (request, wanted) => {
    for (const row of incoming) {
      const matched = taken.has(row.hash) ? null : matchOf(request, row);

      if (matched && (wanted === "guess") === (matched !== "amount-memo")) {
        taken.add(row.hash);
        matches.set(request.id, {
          at: row.time ?? undefined,
          hash: row.hash,
          lux: row.value,
          matched,
          memo: memoOf(row.memo),
          state: matched === "amount-memo" ? "paid" : "check",
        });

        return;
      }
    }
  };

  for (const request of oldestFirst) {
    if (request.paid) {
      matches.set(request.id, {
        at: request.paid.at,
        hash: request.paid.hash,
        matched: "amount-memo",
        state: "paid",
      });
    } else {
      answer(request, "amount-memo");
    }
  }

  for (const request of oldestFirst) {
    if (!matches.has(request.id)) {
      answer(request, "guess");
    }

    if (!matches.has(request.id)) {
      matches.set(request.id, { state: "waiting" });
    }
  }

  return matches;
}
