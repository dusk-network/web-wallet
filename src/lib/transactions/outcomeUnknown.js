import { getErrorFrom } from "$lib/dusk/error";

/**
 * What sends ran into once their transaction may have gone out: after the
 * node was asked to broadcast it, or the EVM wallet to send it. Whether it
 * did isn't known then, as the answer may be what got lost, so nothing
 * says to send it again. Each with the hash of the transaction that may
 * have gone out, where the wallet built it: "" where it doesn't know it.
 *
 * @type {WeakMap<Error, string>}
 */
const unknown = new WeakMap();

/**
 * Marks what a send ran into once its transaction may have gone out, with
 * that transaction's hash where it's known. A hash it was marked with stays.
 *
 * @param {unknown} error
 * @param {string} [hash] The hash of the transaction that may have gone out
 * @returns {Error} The error, as an Error, marked
 */
export function outcomeUnknown(error, hash = "") {
  const marked = getErrorFrom(error);

  unknown.set(marked, unknown.get(marked) || hash);

  return marked;
}

/**
 * Whether a send ran into `error` once its transaction may have gone out.
 *
 * @param {unknown} error
 */
export const isOutcomeUnknown = (error) =>
  error instanceof Error && unknown.has(error);

/**
 * The hash of the transaction a send may have sent all the same, as it ran
 * into `error`: "" for an error that says nothing went out, or where the
 * transaction isn't known.
 *
 * @param {unknown} error
 * @returns {string}
 */
export const mayHaveSent = (error) =>
  (error instanceof Error && unknown.get(error)) || "";
