/**
 * A DuskEVM withdrawal's claim date as the wallet writes it. The date, and
 * the words around it, come from `@dusk-network/networks/duskevm`.
 */

import { formatTime } from "@dusk-network/networks/format";

/**
 * A claim date as the wallet writes it, in English on the locale's clock and
 * in the user's time zone: "2 Nov, 04:24 CET", or "Today, 04:24 CET".
 *
 * @param {number} ms
 * @param {string} [locale]
 * @param {string} [timeZone]
 */
export const claimDay = (ms, locale, timeZone) =>
  formatTime(ms, { locale: locale || undefined, timeZone });
