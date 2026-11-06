/**
 * What a profile's history says of a payment about to be made: its transfers
 * on their way. The payment it would make again is
 * `@dusk-network/app-core/requests`' to say (`sentAlready`), for both wallets.
 */

import { TX_KIND } from "./constants";

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
