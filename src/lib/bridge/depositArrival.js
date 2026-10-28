/**
 * Where a deposit to DuskEVM arrived, from DuskEVM's explorer, for when
 * DuskEVM's adapter can't say what a Dusk deposit became: the recipient's
 * incoming calls (the network's Blockscout API), read back to its oldest
 * deposit on its way, hold the L2 bridge's payment of each deposit's amount,
 * from after the deposit's Dusk block. The deposits on their way to a
 * recipient take its payments in order, oldest first, one payment each, and
 * none another deposit has.
 */

import {
  normalizedAddress,
  normalizedTxHash,
} from "$lib/bridge/withdrawalActivityValues";
import { duskEvm, duskEvmBlockscoutApiUrl } from "$lib/web3/duskEvm";

/** DUSK has 9 decimals on Dusk and 18 on DuskEVM. */
const WEI_PER_LUX = 1_000_000_000n;

/** Dusk's clock and DuskEVM's can differ a little. */
const CLOCK_SLACK_MS = 120_000;

/**
 * Pages of a recipient's incoming calls read at most, back to its oldest
 * deposit on its way.
 */
const MAX_PAGES = 5;

/**
 * A Blockscout time ("2026-10-26T04:50:15.000000Z") in milliseconds.
 *
 * @param {unknown} text
 */
const timeOf = (text) =>
  Date.parse(String(text ?? "").replace(/(\.\d{3})\d+/u, "$1"));

/**
 * When a deposit went through: its Dusk block's time, as the node gave it;
 * 0 until it did. Never the browser's clock, which may be off.
 *
 * @param {import("./depositActivityStorage").DepositActivityItem} item
 */
const depositTime = (item) => item.l1BlockTimestamp ?? 0;

/**
 * A page of a recipient's incoming calls: the first, or the one Blockscout's
 * `next_page_params` (which repeat the filter) say comes next.
 *
 * @param {string} url The calls' first page
 * @param {Record<string, unknown> | null} next
 */
function pageUrl(url, next) {
  const query = new URLSearchParams({ filter: "to" });

  for (const [key, value] of Object.entries(next ?? {})) {
    query.set(key, String(value));
  }

  return `${url}?${query}`;
}

/**
 * A recipient's incoming calls, newest first, a page at a time (Blockscout's
 * `next_page_params`) back to `since`, or there are no more: null when
 * MAX_PAGES don't reach that far.
 *
 * @param {string} url The calls' first page
 * @param {number} since
 * @param {typeof fetch} fetchFn
 * @returns {Promise<any[] | null>}
 */
async function incomingCalls(url, since, fetchFn) {
  /** @type {any[]} */
  const calls = [];
  /** @type {Record<string, unknown> | null} */
  let next = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    /** @type {Response} */
    const response = await fetchFn(pageUrl(url, next), {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`DuskEVM's explorer answered ${response.status}.`);
    }

    /** @type {any} */
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const oldest = Math.min(
      ...items
        .map((/** @type {any} */ item) => timeOf(item?.timestamp))
        .filter(Number.isFinite)
    );

    calls.push(...items);
    next =
      body?.next_page_params && typeof body.next_page_params === "object"
        ? body.next_page_params
        : null;

    if (!next || !items.length || oldest < since) {
      return calls;
    }
  }

  return null;
}

/**
 * The L2 bridge's payments to a recipient back to `since`, oldest first:
 * null when its calls go back further than MAX_PAGES.
 *
 * @param {string} recipient
 * @param {number} since
 * @param {typeof fetch} fetchFn
 */
async function bridgePayments(recipient, since, fetchFn) {
  const api = duskEvmBlockscoutApiUrl();
  const bridge = normalizedAddress(
    duskEvm.contracts?.L2StandardBridge?.address
  );
  const calls =
    api && bridge
      ? await incomingCalls(
          `${api.replace(/\/+$/u, "")}/addresses/${recipient}/internal-transactions`,
          since,
          fetchFn
        )
      : null;

  if (!calls) {
    return null;
  }

  return calls
    .filter(
      (call) =>
        call?.success !== false &&
        normalizedAddress(call?.from?.hash) === bridge &&
        normalizedTxHash(call?.transaction_hash)
    )
    .map((call) => ({
      at: timeOf(call.timestamp),
      blockNumber:
        call.block_number === undefined || call.block_number === null
          ? null
          : String(call.block_number),
      hash: /** @type {`0x${string}`} */ (
        String(call.transaction_hash).toLowerCase()
      ),
      value: String(call.value ?? ""),
    }))
    .filter(({ at }) => Number.isFinite(at))
    .sort((a, b) => a.at - b.at);
}

/**
 * The deposits on their way to `recipient` whose Dusk block's time is
 * known, oldest first.
 *
 * @param {import("./depositActivityStorage").DepositActivityItem[]} kept
 * @param {string} recipient
 */
const waitingFor = (kept, recipient) =>
  kept
    .filter(
      (item) =>
        normalizedAddress(item.account) === recipient &&
        item.amountLux &&
        depositTime(item) > 0 &&
        !item.l2TransactionHash &&
        item.stage !== "completed" &&
        item.stage !== "failed"
    )
    .sort((a, b) => depositTime(a) - depositTime(b));

/**
 * Where `deposit` arrived on DuskEVM, as its explorer shows it, or null. It
 * isn't looked for until its Dusk block's time is known, and none is found
 * for a recipient whose calls go back further than MAX_PAGES: an older
 * deposit could then take a newer one's payment.
 *
 * @param {import("./depositActivityStorage").DepositActivityItem} deposit
 * @param {import("./depositActivityStorage").DepositActivityItem[]} kept The deposits this browser keeps
 * @param {{ fetch?: typeof fetch }} [options]
 * @returns {Promise<{ blockNumber: string | null, hash: `0x${string}` } | null>}
 */
export async function findDepositArrival(
  deposit,
  kept,
  { fetch: fetchFn = globalThis.fetch } = {}
) {
  const recipient = normalizedAddress(deposit.account);
  const waiting = recipient ? waitingFor(kept, recipient) : [];
  const payments =
    recipient &&
    waiting.some((item) => item.transactionHash === deposit.transactionHash)
      ? await bridgePayments(
          recipient,
          depositTime(waiting[0]) - CLOCK_SLACK_MS,
          fetchFn
        )
      : null;

  if (!payments) {
    return null;
  }

  // Each payment pays one deposit: those matched already are taken.
  const taken = new Set(
    kept.flatMap(({ l2TransactionHash }) =>
      l2TransactionHash ? [l2TransactionHash.toLowerCase()] : []
    )
  );

  for (const item of waiting) {
    const wei = String(BigInt(String(item.amountLux)) * WEI_PER_LUX);
    const paid = payments.find(
      (payment) =>
        !taken.has(payment.hash) &&
        payment.value === wei &&
        payment.at >= depositTime(item) - CLOCK_SLACK_MS
    );

    if (paid) {
      taken.add(paid.hash);

      if (item.transactionHash === deposit.transactionHash) {
        return { blockNumber: paid.blockNumber, hash: paid.hash };
      }
    }
  }

  return null;
}
