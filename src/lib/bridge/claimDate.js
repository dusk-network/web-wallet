/**
 * A DuskEVM withdrawal's claim date in words, as the wallet writes it. The
 * date itself, and whether a claim can be made now, are worked out the way
 * the Portal checks a claim by `@dusk-network/networks/duskevm`
 * (`claimFrom`, `claimReadiness`); the words are the bridge's.
 */

import { aboutTime } from "./routeTimes";
import { formatTime } from "@dusk-network/networks/format";

/**
 * @typedef {import("@dusk-network/networks/duskevm").ClaimDate} ClaimDate
 *   `at` in milliseconds; null when the game's challenger won, or the hub
 *   doesn't know the game.
 * @typedef {import("@dusk-network/networks/duskevm").DuskTip} DuskTip
 *   Dusk's latest block: its height, and its time in seconds.
 */

/**
 * @param {number} n
 * @param {string} word
 */
const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A duration in words, to the minute: "7 days", "3 days 12 hours",
 * "1 hour 30 minutes".
 *
 * @param {bigint | number} seconds
 */
export function durationWords(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) / 60));
  const days = Math.floor(total / 1_440);
  const hours = Math.floor((total % 1_440) / 60);
  const minutes = total % 60;

  if (total < 1) {
    return "less than a minute";
  }

  if (days) {
    return hours
      ? `${unit(days, "day")} ${unit(hours, "hour")}`
      : unit(days, "day");
  }

  if (hours) {
    return minutes
      ? `${unit(hours, "hour")} ${unit(minutes, "minute")}`
      : unit(hours, "hour");
  }

  return unit(minutes, "minute");
}

/**
 * An estimate in words, on the scale the bridge's times use: "about 30
 * minutes", "about 1 hour", "about 7 days".
 *
 * @param {number} seconds
 */
export function aboutWords(seconds) {
  const text = aboutTime(seconds);
  const minutes = /^~(\d+) min$/u.exec(text);

  if (minutes) {
    return `about ${minutes[1]} minute${minutes[1] === "1" ? "" : "s"}`;
  }

  return text.replace(/^~/u, "about ");
}

/**
 * "Claim 7 days after you prove.", from the Portal's proof maturity delay,
 * in seconds.
 *
 * @param {bigint | number} maturity
 */
export const claimAfterProving = (maturity) =>
  `Claim ${durationWords(maturity)} after you prove.`;

/**
 * "You can prove about 30 minutes after sending.", from how often outputs
 * come, in seconds.
 *
 * @param {number} prove
 */
export const provingAfterSending = (prove) =>
  `You can prove ${aboutWords(prove)} after sending.`;

/**
 * Before the proof: "Claim 7 days after you prove. You can prove about 30
 * minutes after sending.", from what the chain said (`routeTime`); "" until
 * it has.
 *
 * @param {{ maturity?: number, prove?: number } | null | undefined} time
 */
export function beforeProofText(time) {
  if (!time?.maturity) {
    return "";
  }

  return time.prove
    ? `${claimAfterProving(time.maturity)} ${provingAfterSending(time.prove)}`
    : claimAfterProving(time.maturity);
}

/**
 * After the proof: "Claim from Mon 2 Nov, 04:24", "Claim from about …"
 * while the game hasn't resolved, or, with its resolution late, "Waiting
 * for DuskEVM to settle this proof. Claim from … at the soonest." `when`
 * writes the date.
 *
 * @param {Partial<ClaimDate> | null | undefined} claim
 * @param {(ms: number) => string} when
 */
export function claimText(claim, when) {
  if (!claim?.at) {
    return "";
  }

  if (claim.overdue) {
    return `Waiting for DuskEVM to settle this proof. Claim from ${when(claim.at)} at the soonest.`;
  }

  return `Claim from ${claim.exact ? "" : "about "}${when(claim.at)}`;
}

/**
 * Before proving: "If you prove now, you can claim from Mon 9 Nov, 03:20",
 * or "from about …" when it's an estimate.
 *
 * @param {Partial<ClaimDate> | null | undefined} claim
 * @param {(ms: number) => string} when
 */
export function proveNowText(claim, when) {
  if (!claim?.at) {
    return "";
  }

  return `If you prove now, you can claim from ${claim.exact ? "" : "about "}${when(claim.at)}`;
}

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
