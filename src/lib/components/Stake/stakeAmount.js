/**
 * The amounts the staking pages take: typed in DUSK, and checked as they
 * are typed, in the words the pages show.
 */

import {
  decimalSeparator,
  normalizeAmount,
  parseDusk,
  readAmount,
} from "@dusk-network/app-core/amounts";
import { leastSozuStake } from "@dusk-network/networks/sozu";

import { BALANCE_MASK } from "$lib/constants/balanceMask";
import { formatDusk, formatFee } from "$lib/dusk/currency/formatDusk";

/**
 * An amount typed in DUSK, in lux, read as the language writes amounts: "1 000"
 * and "1 000,5" in French. Null for what isn't one, and for what could mean
 * either of two amounts, as "1.000" in German.
 *
 * @param {string} text
 * @param {string} [language] The browser's, unless given
 * @returns {bigint | null}
 */
export const readDuskInput = (text, language) =>
  parseDusk(normalizeAmount(text, decimalSeparator(language), language));

/**
 * What's wrong with an amount as typed, in the words of every Dusk app: why
 * "1.000" can't be read, that DUSK has nine decimals, or else an example that
 * can go in this form, written as the language writes decimals. "" for nothing
 * typed, or an amount.
 *
 * @param {string} text
 * @param {string} [language] The browser's, unless given
 * @param {string} [whole] The example's whole part
 * @returns {string}
 */
export function amountProblem(text, language, whole = "10") {
  const { problem } = readAmount(text, language);

  return problem === readAmount("?", language).problem
    ? `Enter an amount such as ${whole} or ${whole}${decimalSeparator(language)}5.`
    : (problem ?? "");
}

/**
 * The least an unstake from Sozu can be: what burns at least 1 lux of
 * stDUSK at the pool's rate now, as the pool rounds the stDUSK it burns
 * down; or all that is staked there, which burns all its stDUSK.
 *
 * @param {{ stake: bigint, supply: bigint } | null} pool
 * @param {bigint} staked What the account has staked with Sozu
 * @returns {bigint}
 */
export function leastSozuUnstake(pool, staked) {
  const least = leastSozuStake(pool) ?? 1n;

  return staked > 0n && staked < least ? staked : least;
}

/**
 * @typedef {{
 *   action?: "stake" | "unstake",
 *   amount: bigint | null,
 *   available: bigint,
 *   fee: bigint,
 *   hidden?: boolean,
 *   keep?: bigint,
 *   locale: string,
 *   minimum?: bigint,
 *   most?: { amount: bigint, error: string },
 *   text: string,
 * }} AmountCheck
 */

/**
 * What stops an amount, as the page says it, or "" when it can go ahead.
 * The amount is paid from `available` with the fee, unless `most` caps it
 * on its own, as what can be unstaked; `keep` stays in `available` after
 * it, as the fee to unstake a stake later; `minimum` is the least it can
 * be, for a stake or, as `action` says, an unstake.
 *
 * @param {AmountCheck} check
 * @returns {{ error: string, isMinimum: boolean, ok: boolean }}
 */
export function checkAmount({
  action = "stake",
  amount,
  available,
  fee,
  hidden = false,
  keep = 0n,
  locale,
  minimum = 0n,
  most,
  text,
}) {
  /** @param {string} error */
  const fail = (error, isMinimum = false) => ({ error, isMinimum, ok: false });

  if (!text.trim()) {
    return { error: "", isMinimum: false, ok: false };
  }

  if (amount === null) {
    return fail(
      amountProblem(text, locale, minimum >= 1_000_000_000n ? "1000" : "10")
    );
  }

  if (amount <= 0n) {
    return fail("Enter an amount greater than 0.");
  }

  if (amount < minimum) {
    return fail(
      `The minimum ${action} is ${formatDusk(minimum, locale)} DUSK.`,
      true
    );
  }

  if (most && amount > most.amount) {
    return fail(most.error);
  }

  const needed = (most ? 0n : amount) + fee + keep;

  // With balances hidden, these don't say what's held.
  if (needed > available && hidden && !most) {
    return fail(
      amount > available
        ? "More than you have."
        : `That leaves too little for ${keep ? "this fee and the fee to unstake later" : "the network fee"}.`
    );
  }

  if (needed > available) {
    return fail(
      most
        ? feeError({ available, canLower: true, fee, hidden, locale })
        : `That's ${formatFee(needed - available, locale, { max: true })} DUSK more than the public balance, with ${keep ? "this fee and the fee to unstake later" : "the network fee"}.`
    );
  }

  return { error: "", isMinimum: false, ok: true };
}

/**
 * Why the network fee can't be paid, and how much is missing: rounded up, so
 * it never reads less than is missing. With balances hidden, the figure,
 * which gives the balance away, is hidden too.
 *
 * @param {{ available: bigint, canLower?: boolean, fee: bigint, hidden?: boolean, locale: string }} shortfall
 *   `available` is the public balance, `fee` the most it can cost, and
 *   `canLower` whether the page has the fee's Edit, to lower it with
 */
export function feeError({
  available,
  canLower = false,
  fee,
  hidden = false,
  locale,
}) {
  const short = hidden
    ? BALANCE_MASK
    : formatFee(fee - available, locale, { max: true });
  const why =
    available > 0n
      ? `The public balance doesn't cover the network fee: ${short} DUSK short.`
      : `The network fee is paid from the public balance, and it's empty: ${short} DUSK short.`;

  return hidden
    ? why
    : `${why} Add that much to it first${canLower && available > 0n ? ", or lower the fee" : ""}.`;
}
