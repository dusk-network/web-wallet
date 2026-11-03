import { getErrorFrom } from "$lib/dusk/error";

/**
 * What sends ran into once their transaction may have gone out: after the
 * node was asked to broadcast it, or the EVM wallet to send it. Whether it
 * did isn't known then, as the answer may be what got lost, so nothing
 * says to send it again.
 *
 * @type {WeakSet<Error>}
 */
const unknown = new WeakSet();

/**
 * Marks what a send ran into once its transaction may have gone out.
 *
 * @param {unknown} error
 * @returns {Error} The error, as an Error, marked
 */
export function outcomeUnknown(error) {
  const marked = getErrorFrom(error);

  unknown.add(marked);

  return marked;
}

/**
 * Whether a send ran into `error` once its transaction may have gone out.
 *
 * @param {unknown} error
 */
export const isOutcomeUnknown = (error) =>
  error instanceof Error && unknown.has(error);
