/**
 * A language for numbers written among English words, as the wallet's are:
 * `locale` itself where its short words for big numbers are in Latin
 * letters, as German's "Mio."; else English words for what a number has words
 * for, as "Cr" for a crore or "M" for a million, in the digits and with the
 * separators of `locale`: "en-IN" for Hindi. `locale` itself where English
 * there writes numbers in another way.
 *
 * @param {string} [locale] The browser's, unless given
 * @returns {string}
 */
export default function englishWords(locale) {
  const { locale: resolved, numberingSystem } = new Intl.NumberFormat(
    locale || undefined
  ).resolvedOptions();

  if (/^en(-|$)/i.test(resolved)) {
    return resolved;
  }

  // Millions as the language writes them short: in Latin letters, with no
  // mark of direction in them, they read well among English words.
  const short = new Intl.NumberFormat(resolved, {
    notation: "compact",
  }).format(56_900_000);
  const isLatin =
    [...short.matchAll(/\p{L}/gu)].every(([letter]) =>
      /\p{Script=Latin}/u.test(letter)
    ) && !/\p{Cf}/u.test(short);

  if (isLatin) {
    return resolved;
  }

  const region = new Intl.Locale(resolved).maximize().region ?? "001";
  const english = new Intl.Locale(`en-${region}`, {
    numberingSystem,
  }).toString();

  /** @param {string} tag */
  const written = (tag) => new Intl.NumberFormat(tag).format(1_234_567.89);

  return written(english) === written(resolved) ? english : resolved;
}
