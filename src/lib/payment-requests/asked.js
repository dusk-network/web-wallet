/**
 * Whether a page asks for a payment: apart from the rest of payment requests'
 * code, for the tab's title to know it on a page that loads no wallet.
 */

/** What an address of Send has for it to be a request. */
export const REQUEST_FIELDS = Object.freeze([
  "amount",
  "amountLux",
  "label",
  "memo",
  "network",
  "to",
]);

/**
 * Whether a page, as the place an unlock goes on to ("/dashboard/send?to=…"),
 * is Send's with what a request says, whether or not it can be paid.
 *
 * @param {string | null} place
 */
export function asksPayment(place) {
  if (!place || !/^\/dashboard\/send\/?\?/.test(place)) {
    return false;
  }

  const fields = new URLSearchParams(place.slice(place.indexOf("?")));

  return REQUEST_FIELDS.some((field) => fields.has(field));
}
