/**
 * Where a deposit to DuskEVM arrived, from DuskEVM's explorer, for when
 * DuskEVM's adapter can't say what a Dusk deposit became: the recipient's
 * incoming calls (the network's Blockscout API) hold the L2 bridge's
 * payment of each deposit's amount, from after the deposit. The deposits on
 * their way to a recipient take its payments in order, oldest first, one
 * payment each, and none another deposit has.
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
 * A Blockscout time ("2026-10-26T04:50:15.000000Z") in milliseconds.
 *
 * @param {unknown} text
 */
const timeOf = (text) =>
  Date.parse(String(text ?? "").replace(/(\.\d{3})\d+/u, "$1"));

/**
 * The L2 bridge's payments to a recipient, oldest first.
 *
 * @param {string} recipient
 * @param {typeof fetch} fetchFn
 */
async function bridgePayments(recipient, fetchFn) {
  const api = duskEvmBlockscoutApiUrl();
  const bridge = normalizedAddress(
    duskEvm.contracts?.L2StandardBridge?.address
  );

  if (!api || !bridge) {
    return null;
  }

  const response = await fetchFn(
    `${api.replace(/\/+$/u, "")}/addresses/${recipient}/internal-transactions?filter=to`,
    { headers: { accept: "application/json" } }
  );

  if (!response.ok) {
    throw new Error(`DuskEVM's explorer answered ${response.status}.`);
  }

  const { items } = await response.json();

  return (Array.isArray(items) ? items : [])
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
 * The deposits on their way to `recipient`, oldest first.
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
        !item.l2TransactionHash &&
        item.stage !== "completed" &&
        item.stage !== "failed"
    )
    .sort((a, b) => a.createdAt - b.createdAt);

/**
 * Where `deposit` arrived on DuskEVM, as its explorer shows it, or null.
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
  const payments =
    recipient && deposit.amountLux
      ? await bridgePayments(recipient, fetchFn)
      : null;

  if (!recipient || !payments) {
    return null;
  }

  // Each payment pays one deposit: those matched already are taken.
  const taken = new Set(
    kept.flatMap(({ l2TransactionHash }) =>
      l2TransactionHash ? [l2TransactionHash.toLowerCase()] : []
    )
  );

  for (const item of waitingFor(kept, recipient)) {
    const wei = String(BigInt(String(item.amountLux)) * WEI_PER_LUX);
    const paid = payments.find(
      (payment) =>
        !taken.has(payment.hash) &&
        payment.value === wei &&
        payment.at >= item.createdAt - CLOCK_SLACK_MS
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
