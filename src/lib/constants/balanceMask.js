/** What a balance shows while balances are hidden. */
export const BALANCE_MASK = "••••";

/**
 * What's typed in a field that shows the mask as its value: deleting from the
 * mask is a change too, and what's left of it goes.
 *
 * @param {string} text
 */
export const withoutBalanceMask = (text) =>
  text.replaceAll(BALANCE_MASK[0], "");
