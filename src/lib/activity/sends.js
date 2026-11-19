/**
 * What a profile's history says of a payment about to be made: its transfers
 * on their way, and those whose answer never came. The payment it would make
 * again is `@dusk-network/app-core/requests`' to say (`sentAlready`), for
 * both wallets.
 */

import { PENDING_MS } from "@dusk-network/app-core/activity";

import { TX_KIND } from "./constants";

/**
 * The transfers sent from here, with the status given, newest first.
 *
 * @param {ActivityRow[]} rows
 * @param {ActivityRow["status"]} status
 */
const sentTransfers = (rows, status) =>
  rows.filter(
    (row) =>
      row.source === "sent" &&
      row.status === status &&
      row.kind === TX_KIND.TRANSFER &&
      row.direction === "out",
  );

/**
 * The transfers sent from here that aren't in a block yet, newest first.
 *
 * @param {ActivityRow[]} rows
 * @returns {ActivityRow[]}
 */
export const onTheirWay = (rows) => sentTransfers(rows, "pending");

/**
 * The transfers sent from here, in the last PENDING_MS, that aren't
 * confirmed yet: handed to the node, its answer never came, and the chain
 * doesn't have them yet. They may have gone out, and aren't on their way
 * for all that's known. Newest first.
 *
 * @param {ActivityRow[]} rows
 * @param {number} [now]
 * @returns {ActivityRow[]}
 */
export const notConfirmed = (rows, now = Date.now()) =>
  sentTransfers(rows, "unknown").filter(
    ({ time }) => time !== null && now - time < PENDING_MS,
  );
