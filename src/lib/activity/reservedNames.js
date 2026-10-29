/**
 * Which `.dusk` name each reservation in the history was for: the name of
 * the registration that reveals it, sent after it from the same account and
 * checked against that account when the history read it. A reservation that
 * none reveals has no name. Worked out from the history as it changes:
 * nothing is asked of the network.
 */

import { revealsReservation } from "@duskdomains/sdk/call-facts";
import { get, writable } from "svelte/store";

const store = writable(/** @type {Map<string, string>} */ (new Map()));

/**
 * Whether `row` comes after `earlier` in an account's history: in a later
 * block, or not in one yet, or sent later while neither is in a block.
 *
 * @param {ActivityRow} row
 * @param {ActivityRow} earlier
 */
function isAfter(row, earlier) {
  if (row.blockHeight !== undefined && earlier.blockHeight !== undefined) {
    return row.blockHeight > earlier.blockHeight;
  }

  if (earlier.blockHeight !== undefined) {
    return true;
  }

  return (
    row.blockHeight === undefined &&
    (row.submittedAt ?? 0) > (earlier.submittedAt ?? 0)
  );
}

/**
 * Each reservation's name, by its transaction: that of the first
 * registration after it that reveals its commitment.
 *
 * @param {ActivityRow[]} rows
 * @returns {Map<string, string>}
 */
export function reservationNames(rows) {
  const registrations = rows
    .filter((row) => row.nameCommit?.kind === "registration")
    .sort((a, b) => (isAfter(a, b) ? 1 : isAfter(b, a) ? -1 : 0));

  /** @type {Map<string, string>} */
  const names = new Map();

  for (const row of rows) {
    const registration = registrations.find(
      (each) =>
        isAfter(each, row) &&
        revealsReservation(each.nameCommit, row.nameCommit)
    );

    if (registration?.registeredName) {
      names.set(row.hash, registration.registeredName);
    }
  }

  return names;
}

/**
 * @param {Map<string, string>} a
 * @param {Map<string, string>} b
 */
const sameNames = (a, b) =>
  a.size === b.size && [...a].every(([hash, name]) => b.get(hash) === name);

/**
 * Works the reservations' names out for the rows.
 *
 * @param {ActivityRow[]} rows
 */
function load(rows) {
  const next = reservationNames(rows);

  if (!sameNames(next, get(store))) {
    store.set(next);
  }
}

export default { load, subscribe: store.subscribe };
