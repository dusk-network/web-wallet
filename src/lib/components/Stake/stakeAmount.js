/**
 * The amounts the staking pages take: typed in DUSK, and checked as they
 * are typed, in the words the pages show.
 */

import { normalizeAmount, parseDusk } from "@dusk-network/app-core/amounts";
import { leastSozuStake } from "@dusk-network/networks/sozu";

import { formatDusk, formatFee } from "$lib/dusk/currency/formatDusk";

const LUX_DECIMALS = 9;

/**
 * Whether a normalized amount is only wrong by having more decimals than a
 * Lux has.
 *
 * @param {string} text
 */
export const hasTooManyDecimals = (text) =>
  /^\d*\.\d+$/.test(text.trim()) &&
  text.trim().split(".")[1].length > LUX_DECIMALS;

/**
 * An amount typed in DUSK, in lux: digits, with up to nine decimals after a
 * point. Null when it isn't one.
 *
 * @param {string} text
 * @returns {bigint | null}
 */
export const parseDuskInput = (text) => parseDusk(text);

/**
 * An amount as typed, in the form parseDuskInput reads. What could mean
 * either of two amounts stays as typed, for the parser to refuse.
 *
 * @param {string} text
 * @param {string} [decimalSeparator] The language's: "." or ","
 * @returns {string}
 */
export const normalizeDuskInput = (text, decimalSeparator = ".") =>
  normalizeAmount(text, decimalSeparator);

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
 * What to enter instead of what isn't an amount, written as the language
 * writes decimals: "Enter an amount such as 10 or 10,5."
 *
 * @param {bigint} minimum
 * @param {string} locale
 */
function exampleError(minimum, locale) {
  let point = ".";

  try {
    point =
      new Intl.NumberFormat(locale || undefined)
        .formatToParts(1.5)
        .find((part) => part.type === "decimal")?.value ?? ".";
  } catch {
    // The point, then.
  }

  const whole = minimum >= 1_000_000_000n ? "1000" : "10";

  return `Enter an amount such as ${whole} or ${whole}${point}5.`;
}

/**
 * @typedef {{
 *   action?: "stake" | "unstake",
 *   amount: bigint | null,
 *   available: bigint,
 *   fee: bigint,
 *   hidden?: boolean,
 *   locale: string,
 *   minimum?: bigint,
 *   most?: { amount: bigint, error: string },
 *   text: string,
 * }} AmountCheck
 */

/**
 * What stops an amount, as the page says it, or "" when it can go ahead.
 * The amount is paid from `available` with the fee, unless `most` caps it
 * on its own, as what can be unstaked; `minimum` is the least it can be,
 * for a stake or, as `action` says, an unstake.
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
    return fail(exampleError(minimum, locale));
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

  const needed = (most ? 0n : amount) + fee;

  // With balances hidden, these don't say what's held.
  if (needed > available && hidden && !most) {
    return fail(
      amount > available
        ? "More than you have."
        : "That leaves too little for the network fee."
    );
  }

  if (needed > available) {
    return fail(
      most
        ? feeError(available)
        : `That's ${formatFee(needed - available, locale, { max: true })} DUSK more than the public balance, with the network fee.`
    );
  }

  return { error: "", isMinimum: false, ok: true };
}

/**
 * Why the network fee can't be paid.
 *
 * @param {bigint} available The public balance
 */
export const feeError = (available) =>
  available > 0n
    ? "The public balance doesn't cover the network fee."
    : "The network fee is paid from the public balance, and it's empty.";
