/**
 * The amounts the staking pages take: typed in DUSK, and checked as they
 * are typed, in the words the pages show.
 */

import { formatDusk, formatFee } from "$lib/dusk/currency/formatDusk";

const LUX_DECIMALS = 9;

/**
 * An amount typed in DUSK, in lux: digits, with up to nine decimals after a
 * point. Null when it isn't one.
 *
 * @param {string} text
 * @returns {bigint | null}
 */
export function parseDuskInput(text) {
  const value = text.trim();

  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) {
    return null;
  }

  const [whole, fraction = ""] = value.split(".");

  if (fraction.length > LUX_DECIMALS) {
    return null;
  }

  return (
    BigInt(whole || "0") * 10n ** BigInt(LUX_DECIMALS) +
    BigInt(fraction.padEnd(LUX_DECIMALS, "0"))
  );
}

/**
 * @typedef {{
 *   amount: bigint | null,
 *   available: bigint,
 *   fee: bigint,
 *   locale: string,
 *   minimum?: bigint,
 *   most?: { amount: bigint, error: string },
 *   text: string,
 * }} AmountCheck
 */

/**
 * What stops an amount, as the page says it, or "" when it can go ahead.
 * The amount is paid from `available` with the fee, unless `most` caps it
 * on its own, as what can be unstaked; `minimum` is the least it can be.
 *
 * @param {AmountCheck} check
 * @returns {{ error: string, isMinimum: boolean, ok: boolean }}
 */
export function checkAmount({
  amount,
  available,
  fee,
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
      minimum > 0n
        ? "Enter an amount such as 1000 or 1000.5."
        : "Enter an amount such as 10 or 10.5."
    );
  }

  if (amount <= 0n) {
    return fail("Enter an amount greater than 0.");
  }

  if (amount < minimum) {
    return fail(
      `The minimum stake is ${formatDusk(minimum, locale)} DUSK.`,
      true
    );
  }

  if (most && amount > most.amount) {
    return fail(most.error);
  }

  const needed = (most ? 0n : amount) + fee;

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
