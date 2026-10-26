import { get } from "svelte/store";

import {
  WITHDRAWAL_WAITING_PERIOD_SECONDS,
  roughDuration,
  withdrawalStageDefaultMessage,
  withdrawalStageProgress,
} from "$lib/bridge/withdrawalLifecycle";
import { formatDusk } from "$lib/dusk/currency";
import { middleEllipsis } from "$lib/dusk/string";
import { settingsStore } from "$lib/stores";

/**
 * @param {string} value
 */
export function shortened(value) {
  return middleEllipsis(value, 8);
}

/**
 * @param {string | null | undefined} value
 */
export function formatTimestamp(value) {
  if (!value) {
    return "Pending";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Pending"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

/**
 * An amount in wei, in the wallet's one number format.
 *
 * @param {string | null | undefined} value
 */
function formatAmount(value) {
  if (!value || !/^\d+$/u.test(value)) {
    return null;
  }

  return `${formatDusk(BigInt(value) / 10n ** 9n, get(settingsStore).language)} DUSK`;
}

/**
 * @param {any} item
 */
export function activityAmount(item) {
  return formatAmount(item?.amountWei);
}

/**
 * @param {number} step
 * @param {string} stage
 * @param {number} stepCount
 */
export function timelineState(step, stage, stepCount) {
  const progress = withdrawalStageProgress(stage);

  if (progress === stepCount || step < progress) {
    return "complete";
  }

  return step === progress ? "current" : "pending";
}

/**
 * "31 Oct, 14:20", in the user's locale and time zone.
 *
 * @param {number} milliseconds
 * @param {string} [locale]
 */
export function formatClaimTime(milliseconds, locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(milliseconds);
}

/**
 * The claim time once Dusk knows it, otherwise the time left: estimated from
 * the proof, or the usual waiting period. A rejected proof can't be claimed.
 *
 * @param {any} item
 * @param {number} now
 */
function waitingPeriodMessage(item, now) {
  if (item.proofRejected) {
    return "The proof was rejected. Prove again once DuskEVM reports a new output.";
  }

  const claimAt = item.readyAt
    ? Number(item.readyAt) * 1_000
    : Date.parse(item.challengePeriodEnd ?? "");

  if (item.readyAt && item.readyAtExact) {
    return `Claim from ${formatClaimTime(claimAt)}.`;
  }

  const remaining =
    claimAt > now ? (claimAt - now) / 1_000 : WITHDRAWAL_WAITING_PERIOD_SECONDS;

  return `Claim in about ${roughDuration(remaining)}.`;
}

/**
 * @param {any} item
 * @param {number} [now]
 */
export function stageMessage(item, now = Date.now()) {
  return item?.stage === "proven_waiting"
    ? waitingPeriodMessage(item, now)
    : withdrawalStageDefaultMessage(item?.stage);
}
