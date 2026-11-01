import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** The words a recovery phrase is made of. */
export const RECOVERY_WORDS = new Set(wordlist);

/**
 * "Word 7", "Words 3 and 7", "Words 3, 5 and 7".
 *
 * @param {number[]} numbers
 */
function wordsNamed(numbers) {
  if (numbers.length === 1) {
    return `Word ${numbers[0]}`;
  }

  return `Words ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
}

/**
 * The words that aren't recovery words, said; "" for none.
 *
 * @param {string[]} typed
 */
function unknownWords(typed) {
  const unknown = typed.flatMap((word, i) =>
    word && !RECOVERY_WORDS.has(word) ? [i + 1] : []
  );

  if (unknown.length > 3) {
    return `${unknown.length} words aren't recovery words. Check the marked ones.`;
  }

  if (unknown.length === 1) {
    return `${wordsNamed(unknown)} isn't a recovery word. Check its spelling.`;
  }

  return unknown.length
    ? `${wordsNamed(unknown)} aren't recovery words. Check their spelling.`
    : "";
}

/**
 * The words missing among those typed, said; "" for none.
 *
 * @param {string[]} typed
 */
function missingWords(typed) {
  const missing = typed.flatMap((word, i) => (word ? [] : [i + 1]));

  if (missing.length > 3) {
    return `${missing.length} words are missing.`;
  }

  return missing.length
    ? `${wordsNamed(missing)} ${missing.length === 1 ? "is" : "are"} missing.`
    : "";
}

/**
 * What's wrong with a phrase's words, in one plain sentence; "" when
 * nothing is, or nothing is typed. `words` are the boxes' words in order,
 * "" for an empty one; `pasted`, the count of a paste with more words than
 * there are boxes.
 *
 * @param {string[]} words
 * @param {{ pasted?: number }} [options]
 */
export function phraseProblem(words, { pasted = 0 } = {}) {
  let last = words.length - 1;

  while (last >= 0 && !words[last]) {
    last--;
  }

  if (last < 0) {
    return "";
  }

  const typed = words.slice(0, last + 1);
  const said = unknownWords(typed) || missingWords(typed);
  const n = pasted > typed.length ? pasted : typed.length;

  if (said) {
    return said;
  }

  if (n !== 12 && n !== 24) {
    return `That's ${n} ${n === 1 ? "word" : "words"}. A recovery phrase has 12 or 24.`;
  }

  return validateMnemonic(typed.join(" "), wordlist)
    ? ""
    : "That isn't a valid recovery phrase. Check each word.";
}

/**
 * A phrase's words as they're pasted or typed: in lower case, however
 * they're spaced.
 *
 * @param {string} text
 */
export const wordsOf = (text) =>
  String(text ?? "")
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
