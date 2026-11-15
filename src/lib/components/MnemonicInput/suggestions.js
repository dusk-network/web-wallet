import { wordlist } from "@scure/bip39/wordlists/english.js";

import { announce } from "$lib/dusk/announce";

/*
 * Until app-core 0.17.0: its `wordSuggestions` and `isRecoveryWord`
 * (`@dusk-network/app-core/recovery-words`), as both wallets take them, and
 * as they read what's typed: as BIP-39 reads a phrase (NFKD), accents aside,
 * in any case, without the spaces around it; suggestions from two letters.
 */

/** @param {unknown} text */
const plain = (text) =>
  typeof text === "string"
    ? text
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
    : "";

/**
 * @param {string} prefix
 * @param {readonly string[]} words
 * @param {number} [limit]
 * @returns {string[]}
 */
function wordSuggestions(prefix, words, limit = 4) {
  const start = plain(prefix);

  return [...start].length < 2
    ? []
    : words.filter((word) => plain(word).startsWith(start)).slice(0, limit);
}

/**
 * @param {string} word
 * @param {readonly string[]} words
 */
const isRecoveryWord = (word, words) =>
  Boolean(plain(word)) && words.some((each) => plain(each) === plain(word));

/** The most words a box suggests. */
const MOST = 4;

/** The list's words as it spells them, each the same word at once. */
const LISTED = new Set(wordlist);

/**
 * The letters typed in a box, as app-core counts them for its suggestions:
 * accents aside, without the spaces around.
 *
 * @param {string} typed
 */
const lettersIn = (typed) =>
  [
    ...typed
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim(),
  ].length;

/**
 * The recovery words a box suggests for what's typed in it, from the wallet's
 * own BIP39 English list: from two letters, up to four that start with them,
 * none for the one word they spell that starts no other.
 *
 * @param {string} typed
 * @returns {string[]}
 */
export function suggestionsFor(typed) {
  const words = wordSuggestions(typed, wordlist, MOST);

  return words.length === 1 && words[0] === typed.trim().toLowerCase()
    ? []
    : words;
}

/**
 * Whether a box's word is a recovery word, an accent or a capital aside.
 *
 * @param {string} word
 */
export const isWord = (word) =>
  LISTED.has(word) || isRecoveryWord(word, wordlist);

/**
 * A box's word as the list spells it, which the phrase is made of: "abándon"
 * is "abandon". What isn't a recovery word stays as it's typed.
 *
 * @param {string} word
 */
export const listWord = (word) =>
  !LISTED.has(word) && isRecoveryWord(word, wordlist)
    ? wordSuggestions(word, wordlist, 1)[0]
    : word;

/**
 * Whether what's typed in a box, two letters or more, starts no recovery
 * word: it's marked at once, as it can't become one.
 *
 * @param {string} typed
 */
export const startsNoWord = (typed) =>
  lettersIn(typed) >= 2 && !wordSuggestions(typed, wordlist, 1).length;

/** What a box whose word isn't a recovery word says, under it. */
export const NOT_A_WORD = "Not a recovery word";

/**
 * Whether a box is marked as it's typed in, for what's typed now; said to
 * screen readers as the mark comes, as it shows.
 *
 * @param {string} typed
 * @param {boolean} wasMarked
 */
export function markAsTyped(typed, wasMarked) {
  const isMarked = startsNoWord(typed);

  if (isMarked && !wasMarked) {
    announce(NOT_A_WORD, 3000);
  }

  return isMarked;
}

/**
 * A suggested word's id, in its listbox `list`: its box's active descendant
 * while it's highlighted.
 *
 * @param {string} list
 * @param {string} word
 */
export const optionId = (list, word) => `${list}-${word}`;

/**
 * What a key does in a box whose suggestions show: moves the highlight
 * ("next" or "previous"), takes the highlighted word ("take": Enter, and Tab
 * forward), closes them ("close": Escape), or nothing of theirs ("").
 *
 * @param {KeyboardEvent} event
 * @returns {"" | "close" | "next" | "previous" | "take"}
 */
export function suggestionKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
    return "";
  }

  switch (event.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Enter":
      return "take";
    case "Escape":
      return "close";
    case "Tab":
      return event.shiftKey ? "" : "take";
    default:
      return "";
  }
}
