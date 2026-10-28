/**
 * DUSK as the wallet shows it: the one number format of the extension.
 * Amounts show at most four decimals, without trailing zeros and with the
 * thousands grouped; an amount under review shows every decimal it has. A
 * fee rounds to four decimals: up for the most it can cost, to the nearest
 * for what it cost. Full precision stays in details, on hover and in an
 * export.
 *
 * Every function takes LUX, as a bigint or anything `BigInt` reads, and a
 * BCP 47 language tag; a negative amount takes a minus sign.
 */

/** Decimals an amount shows. */
export const DUSK_DISPLAY_DECIMALS = 4;

const LUX_DECIMALS = 9;
const LUX_PER_DUSK = 10n ** BigInt(LUX_DECIMALS);
const STEP = 10n ** BigInt(LUX_DECIMALS - DUSK_DISPLAY_DECIMALS);

/**
 * @typedef {{ decimal: string, digits: string[], whole: Intl.NumberFormat }} LocaleParts
 */

/** @type {Map<string, LocaleParts>} */
const byLocale = new Map();

/**
 * How a locale writes a number: its decimal separator, its digits from 0 to
 * 9 and its grouping of whole numbers.
 *
 * @param {string | undefined} locale
 * @returns {LocaleParts}
 */
function localeParts(locale) {
  const key = locale ?? "";
  const known = byLocale.get(key);

  if (known) {
    return known;
  }

  const plain = new Intl.NumberFormat(locale || undefined, {
    useGrouping: false,
  });
  const ninesToZero = Array.from(plain.format(1234567890));
  const parts = {
    decimal:
      plain.formatToParts(1.5).find((part) => part.type === "decimal")?.value ??
      ".",
    digits: [ninesToZero[9], ...ninesToZero.slice(0, 9)],
    whole: new Intl.NumberFormat(locale || undefined, {
      maximumFractionDigits: 0,
    }),
  };

  byLocale.set(key, parts);

  return parts;
}

/** @param {bigint | number | string} value */
const toLux = (value) => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

/**
 * Whole DUSK and the digits after the point, in the locale's writing.
 *
 * @param {boolean} negative
 * @param {bigint} whole
 * @param {string} fraction Latin digits
 * @param {string | undefined} locale
 */
function written(negative, whole, fraction, locale) {
  const { decimal, digits, whole: grouped } = localeParts(locale);
  const decimals = Array.from(fraction, (d) => digits[Number(d)]).join("");

  return `${negative ? "−" : ""}${grouped.format(whole)}${decimals ? `${decimal}${decimals}` : ""}`;
}

/**
 * LUX as whole DUSK and its nine decimals, trailing zeros trimmed.
 *
 * @param {bigint} lux Not negative
 */
const exactParts = (lux) => ({
  fraction: (lux % LUX_PER_DUSK)
    .toString()
    .padStart(LUX_DECIMALS, "0")
    .replace(/0+$/, ""),
  whole: lux / LUX_PER_DUSK,
});

/**
 * Units of the smallest step shown, as whole DUSK and its decimals.
 *
 * @param {bigint} units
 */
const stepParts = (units) => ({
  fraction: (units % (LUX_PER_DUSK / STEP))
    .toString()
    .padStart(DUSK_DISPLAY_DECIMALS, "0")
    .replace(/0+$/, ""),
  whole: units / (LUX_PER_DUSK / STEP),
});

/**
 * An amount: at most four decimals, the rest cut, trailing zeros trimmed,
 * thousands grouped. One that would show as zero shows in full.
 *
 * @param {bigint | number | string} value LUX
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDusk(value, locale) {
  const lux = toLux(value);
  const abs = lux < 0n ? -lux : lux;
  const units = abs / STEP;

  if (units === 0n && abs !== 0n) {
    return formatDuskExact(lux, locale);
  }

  const { fraction, whole } = stepParts(units);

  return written(lux < 0n, whole, fraction, locale);
}

/**
 * An amount exactly: every decimal it has, thousands grouped.
 *
 * @param {bigint | number | string} value LUX
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDuskExact(value, locale) {
  const lux = toLux(value);
  const { fraction, whole } = exactParts(lux < 0n ? -lux : lux);

  return written(lux < 0n, whole, fraction, locale);
}

/**
 * A fee: exact up to four decimals. Past them, the most it can cost
 * (`max`) rounds up, so it never reads lower than it can be, and what it
 * cost rounds to the nearest, half up. A fee too small for four decimals
 * shows in full, and its maximum as the smallest step.
 *
 * @param {bigint | number | string} value LUX
 * @param {string} [locale]
 * @param {{ max?: boolean }} [options]
 * @returns {string}
 */
export function formatFee(value, locale, { max = false } = {}) {
  const lux = toLux(value);

  if (lux <= 0n) {
    return written(false, 0n, "", locale);
  }

  const units = max ? (lux + STEP - 1n) / STEP : (lux + STEP / 2n) / STEP;

  if (units === 0n) {
    return formatDuskExact(lux, locale);
  }

  const { fraction, whole } = stepParts(units);

  return written(false, whole, fraction, locale);
}

/**
 * The most a transaction can take from a balance, as a summary's Total: up
 * to four decimals rounded up, as fees are, unless that would read more
 * than the balance as it shows, cut to four; then exactly, so that a Total
 * at Max never reads more than there is.
 *
 * @param {bigint | number | string} total LUX
 * @param {bigint | number | string} available LUX, the balance it's paid from
 * @param {string} [locale]
 * @returns {string}
 */
export function formatTotal(total, available, locale) {
  const lux = toLux(total);
  const roundedUp = ((lux + STEP - 1n) / STEP) * STEP;
  const shown = (toLux(available) / STEP) * STEP;

  return lux > 0n && roundedUp > shown
    ? formatDuskExact(lux, locale)
    : formatFee(lux, locale, { max: true });
}

/**
 * An amount for a file, such as a CSV export: every decimal, a point and no
 * grouping, whatever the language.
 *
 * @param {bigint | number | string} value LUX
 * @returns {string}
 */
export function formatDuskPlain(value) {
  const lux = toLux(value);
  const { fraction, whole } = exactParts(lux < 0n ? -lux : lux);

  return `${lux < 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
