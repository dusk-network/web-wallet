/**
 * When a DuskEVM withdrawal can be claimed on Dusk, worked out from the chain
 * the way the Portal checks a claim:
 * - the proof has matured: `proofMaturityDelaySeconds` after it was made;
 * - its dispute game has resolved for the proposal and is final:
 *   `disputeGameFinalityDelaySeconds` after it resolved.
 * It's exact once the game has resolved. Before that, the game resolves no
 * sooner than its clock runs out (`maxClockDuration` after it was created),
 * which gives the earliest date, an estimate.
 *
 * The times are the contracts' own. The deployed testnet contracts count Dusk
 * block height × 10; the others count block time and compare strictly, so a
 * claim there comes a second later. The rule, its test vectors and its words
 * are the bridge's (`claim-date.js`).
 */

import { aboutTime } from "./routeTimes";
import { formatTime } from "@dusk-network/networks/format";

/** A dispute game's status, as its hub gives it. */
export const GAME_STATUS = Object.freeze({
  CHALLENGER_WINS: 1,
  DEFENDER_WINS: 2,
  IN_PROGRESS: 0,
});

/** A game still unresolved this long past the earliest it could resolve is overdue. */
export const OVERDUE_SECONDS = 3_600n;

/**
 * @typedef {{ height: bigint | number, timestamp: bigint | number }} DuskTip
 *   Dusk's latest block: its height, and its time in seconds.
 * @typedef {"height" | "timestamp"} ContractClock
 *   What a deployment's contracts count: Dusk block height × 10, or block time.
 * @typedef {{ createdAt: bigint | number, resolvedAt: bigint | number, status: number }} ClaimGame
 *   A dispute game, as its hub gives it.
 * @typedef {{ finalitySeconds: bigint | number, maturitySeconds: bigint | number, maxClockSeconds: bigint | number }} ClaimTiming
 *   The Portal's delays and the game's clock limit.
 * @typedef {{ at: number | null, exact: boolean, overdue: boolean }} ClaimDate
 *   `at` in milliseconds; null when the game's challenger won, or the hub
 *   doesn't know the game.
 */

/** @type {ClaimDate} */
const NO_DATE = Object.freeze({ at: null, exact: false, overdue: false });

/**
 * @param {bigint} a
 * @param {bigint} b
 */
const distance = (a, b) => (a > b ? a - b : b - a);

/**
 * @param {bigint} a
 * @param {bigint} b
 */
const later = (a, b) => (a > b ? a : b);

/**
 * The clock a deployment's contracts keep, read from one of their times:
 * "height" (Dusk block height × 10, as the deployed testnet contracts count)
 * or "timestamp" (block time). At the tip the two are decades apart, so a
 * time is on whichever it's nearer.
 *
 * @param {bigint | number} sample
 * @param {DuskTip} tip
 * @returns {ContractClock}
 */
export function contractClock(sample, tip) {
  const time = BigInt(sample);

  return distance(time, 10n * BigInt(tip.height)) <
    distance(time, BigInt(tip.timestamp))
    ? "height"
    : "timestamp";
}

/**
 * The contracts' time at the tip.
 *
 * @param {ContractClock} clock
 * @param {DuskTip} tip
 */
export const contractNow = (clock, tip) =>
  clock === "height" ? 10n * BigInt(tip.height) : BigInt(tip.timestamp);

/**
 * A contract time as wall-clock milliseconds. On the height clock it's
 * counted from the tip, at Dusk's 10 seconds a block.
 *
 * @param {bigint | number} seconds
 * @param {ContractClock} clock
 * @param {DuskTip} tip
 */
export function wallTime(seconds, clock, tip) {
  const time = BigInt(seconds);
  const wall =
    clock === "height"
      ? BigInt(tip.timestamp) + time - 10n * BigInt(tip.height)
      : time;

  return Number(wall) * 1_000;
}

/**
 * When a withdrawal can be claimed.
 *
 * @param {object} input
 * @param {ClaimGame | null | undefined} input.game Its dispute game, from the game's hub
 * @param {{ clock?: ContractClock }} [input.network] The deployment's clock,
 *   read from the game's own time when not given
 * @param {bigint | number | null} [input.provenAt] The Portal's proof time; none for a proof made now
 * @param {ClaimTiming} input.timing
 * @param {DuskTip} input.tip Dusk's latest block
 * @returns {ClaimDate}
 */
export function claimFrom({
  game,
  network = {},
  provenAt = null,
  timing,
  tip,
}) {
  if (!game) {
    return NO_DATE;
  }

  const created = BigInt(game.createdAt);

  if (created === 0n || Number(game.status) === GAME_STATUS.CHALLENGER_WINS) {
    return NO_DATE;
  }

  const clock = network.clock ?? contractClock(created, tip);
  const now = contractNow(clock, tip);
  const strict = clock === "height" ? 0n : 1n;
  const resolved = Number(game.status) === GAME_STATUS.DEFENDER_WINS;
  // The earliest the game resolves: once its clock has run out, and not before now.
  const settles = created + BigInt(timing.maxClockSeconds);
  const resolvedAt = resolved ? BigInt(game.resolvedAt) : later(now, settles);
  const matured =
    (provenAt ? BigInt(provenAt) : now) + BigInt(timing.maturitySeconds);
  const final = resolvedAt + BigInt(timing.finalitySeconds);

  return {
    at: wallTime(later(matured, final) + strict, clock, tip),
    exact: resolved,
    overdue: !resolved && now > settles + OVERDUE_SECONDS,
  };
}

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
