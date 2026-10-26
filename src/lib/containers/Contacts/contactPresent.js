/**
 * How contacts read: their letter, their last payment and their activity
 * from the history, and when their `.dusk` name was last checked.
 */

import { dayLabel, describeRow, rowTime } from "$lib/activity/present";

/**
 * @typedef {{
 *   amount: { exact: string, text: string },
 *   day: string,
 *   verb: "Received" | "Sent",
 * }} LastPayment
 */

/**
 * The letter a contact's avatar shows.
 *
 * @param {string} name
 */
export const initialOf = (name) =>
  (Array.from(name.trim())[0] ?? "?").toLocaleUpperCase();

/**
 * The history's rows with an address as their counterparty, newest first,
 * as the history has them.
 *
 * @param {ActivityRow[]} rows
 * @param {string} address
 * @param {import("$lib/activity/present").PresentContext} context
 */
export const activityWith = (rows, address, context) =>
  rows
    .map((row) => ({ presentation: describeRow(row, context), row }))
    .filter(({ presentation }) => presentation.counterparty === address);

/**
 * The last payment with each address in the history: the newest transfer
 * that went through or is on its way, sent or received.
 *
 * @param {ActivityRow[]} rows The history, newest first
 * @param {import("$lib/activity/present").PresentContext} context
 * @returns {Map<string, LastPayment>}
 */
export function lastPayments(rows, context) {
  /** @type {Map<string, LastPayment>} */
  const payments = new Map();

  for (const row of rows) {
    const p = describeRow(row, context);
    const time = rowTime(row);
    const isTransfer = p.category === "sent" || p.category === "received";

    if (
      p.counterparty &&
      isTransfer &&
      p.status !== "failed" &&
      time !== null &&
      !payments.has(p.counterparty)
    ) {
      payments.set(p.counterparty, {
        amount: { exact: p.amount.exact, text: p.amount.text },
        day: dayLabel(time, { locale: context.locale }),
        verb: p.category === "received" ? "Received" : "Sent",
      });
    }
  }

  return payments;
}

/**
 * When a name was last checked, as "just now", "5 minutes ago" or a date.
 *
 * @param {number} at
 * @param {string} locale
 * @param {number} [now]
 */
export function checkedLabel(at, locale, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (seconds < 60) {
    return "just now";
  }

  if (seconds < 3600) {
    return relative.format(-Math.floor(seconds / 60), "minute");
  }

  if (seconds < 86_400) {
    return relative.format(-Math.floor(seconds / 3600), "hour");
  }

  return `on ${dayLabel(at, { locale, now })}`;
}

/**
 * The address a `.dusk` name points to for a contact: of the same kind as
 * the contact's, a public account or a shielded address.
 *
 * @param {Contact} contact
 * @param {DuskNameResolution} resolution
 * @returns {string | undefined}
 */
export const pointedAddress = (contact, resolution) =>
  contact.type === "address" ? resolution.address : resolution.account;
