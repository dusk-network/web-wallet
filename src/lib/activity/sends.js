/**
 * What a profile's history says of a payment about to be made: its transfers
 * on their way, and the payment it would make again.
 */

import { TX_KIND } from "./constants";

/** How long after it went out a payment just like another is the same one again. */
export const AGAIN_MS = 10 * 60_000;

/**
 * The transfers sent from here that aren't in a block yet, newest first.
 *
 * @param {ActivityRow[]} rows
 * @returns {ActivityRow[]}
 */
export const onTheirWay = (rows) =>
  rows.filter(
    (row) =>
      row.source === "sent" &&
      row.status === "pending" &&
      row.kind === TX_KIND.TRANSFER &&
      row.direction === "out"
  );

/**
 * The latest payment a send would make again: to the same account, of the
 * same amount and with the same memo, sent from this profile in the last ten
 * minutes, or at any time with the same memo, as a request paid already. One
 * that failed sent nothing. Null for none.
 *
 * @param {ActivityRow[]} rows
 * @param {{ lux: bigint, memo: string, now?: number, to: string }} payment
 * @returns {ActivityRow | null}
 */
export function sentAlready(rows, { lux, memo, now = Date.now(), to }) {
  const said = memo.trim();

  if (!to || lux <= 0n) {
    return null;
  }

  return (
    rows
      .filter(
        (row) =>
          row.direction === "out" &&
          row.status !== "failed" &&
          row.counterparty === to &&
          row.value === lux &&
          (row.memo ?? "").trim() === said &&
          row.time !== null &&
          (said !== "" || now - row.time < AGAIN_MS)
      )
      .toSorted((a, b) => (b.time ?? 0) - (a.time ?? 0))[0] ?? null
  );
}
