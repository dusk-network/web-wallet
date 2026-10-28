/**
 * DUSK as the wallet shows it, as `@dusk-network/networks/format` writes
 * it for every Dusk app: at most four decimals, but two significant digits
 * under 0.01, without trailing zeros and with the thousands grouped in the
 * language's way; an amount under review shows every decimal it has.
 * Balances round down and fees up, so neither reads more there is, or less
 * than it can cost. Full precision stays in details, on hover and in an
 * export.
 *
 * Every function takes LUX, as a bigint or anything `BigInt` reads, and a
 * BCP 47 language tag; a negative amount takes a minus sign.
 */

import {
  formatDusk as format,
  formatDuskPlain as plain,
} from "@dusk-network/networks/format";

/** Decimals an amount shows, from 0.01 DUSK. */
export const DUSK_DISPLAY_DECIMALS = 4;

/** 0.01 DUSK: under it, an amount shows two significant digits. */
const SMALL = 10_000_000n;

/** @param {bigint | number | string} value */
const toLux = (value) => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

/**
 * @param {bigint | number | string} value LUX
 * @param {string | undefined} locale
 * @param {"down" | "up" | "nearest"} round
 */
const short = (value, locale, round) =>
  format(toLux(value), { locale: locale || undefined, round }).text;

/**
 * An amount, as a balance shows: at most four decimals, the rest cut.
 *
 * @param {bigint | number | string} value LUX
 * @param {string} [locale]
 * @returns {string}
 */
export const formatDusk = (value, locale) => short(value, locale, "down");

/**
 * An amount exactly: every decimal it has, thousands grouped.
 *
 * @param {bigint | number | string} value LUX
 * @param {string} [locale]
 * @returns {string}
 */
export const formatDuskExact = (value, locale) =>
  format(toLux(value), { locale: locale || undefined, mode: "exact" }).text;

/**
 * A fee: the most it can cost (`max`) rounds up, so it never reads lower
 * than it can be, and what it cost rounds to the nearest, half up.
 *
 * @param {bigint | number | string} value LUX
 * @param {string} [locale]
 * @param {{ max?: boolean }} [options]
 * @returns {string}
 */
export const formatFee = (value, locale, { max = false } = {}) =>
  short(toLux(value) > 0n ? value : 0n, locale, max ? "up" : "nearest");

/**
 * LUX as the short format shows them, rounded `up` or down: to four
 * decimals, or two significant digits under 0.01 DUSK.
 *
 * @param {bigint} lux Not negative
 * @param {boolean} up
 */
function shown(lux, up) {
  const step =
    lux >= SMALL
      ? 100_000n
      : 10n ** BigInt(Math.max(lux.toString().length - 2, 0));

  return (up ? (lux + step - 1n) / step : lux / step) * step;
}

/**
 * The most a transaction can take from a balance, as a summary's Total:
 * rounded up, as fees are, but never reading more than the balance as it
 * shows when it's no more than that: at Max, the balance as it shows.
 *
 * @param {bigint | number | string} total LUX
 * @param {bigint | number | string} available LUX, the balance it's paid from
 * @param {string} [locale]
 * @returns {string}
 */
export function formatTotal(total, available, locale) {
  const lux = toLux(total);
  const balance = toLux(available);

  return lux > 0n && lux <= balance && shown(lux, true) > shown(balance, false)
    ? formatDusk(balance, locale)
    : formatFee(lux, locale, { max: true });
}

/**
 * An amount for a file or a field, such as a CSV export: every decimal, a
 * point and no grouping, whatever the language.
 *
 * @param {bigint | number | string} value LUX
 * @returns {string}
 */
export const formatDuskPlain = (value) => plain(toLux(value));
