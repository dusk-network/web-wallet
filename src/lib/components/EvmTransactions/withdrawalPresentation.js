import { formatUnits } from "viem";

import {
  withdrawalStageDefaultMessage,
  withdrawalStageProgress,
} from "$lib/bridge/withdrawalLifecycle";
import { middleEllipsis } from "$lib/dusk/string";

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
 * @param {string | null | undefined} value
 */
function formatAmount(value) {
  if (!value || !/^\d+$/u.test(value)) {
    return null;
  }

  const [whole, decimals = ""] = formatUnits(BigInt(value), 18).split(".");
  const fraction = decimals.slice(0, 6).replace(/0+$/u, "");

  return `${whole}${fraction ? `.${fraction}` : ""} DUSK`;
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
 * @param {number | bigint | string | undefined} unixTimestamp
 */
function remainingUntilUnix(unixTimestamp) {
  return unixTimestamp === undefined
    ? null
    : remainingUntil(Number(unixTimestamp) * 1_000);
}

/**
 * @param {string | null | undefined} timestamp
 */
function remainingUntilTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  const time = new Date(timestamp).getTime();

  return Number.isNaN(time) ? null : remainingUntil(time);
}

/**
 * @param {number} timestamp
 */
function remainingUntil(timestamp) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((timestamp - Date.now()) / 1_000)
  );

  if (remainingSeconds === 0) {
    return "available now";
  }

  if (remainingSeconds < 60) {
    return `in ${remainingSeconds} seconds`;
  }

  const minutes = Math.ceil(remainingSeconds / 60);

  if (minutes < 60) {
    return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  const hours = Math.ceil(minutes / 60);

  if (hours < 48) {
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const days = Math.ceil(hours / 24);

  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * @param {any} item
 */
function provenWaitingMessage(item) {
  const remaining =
    remainingUntilUnix(item.readyAt) ??
    remainingUntilTimestamp(item.challengePeriodEnd);

  if (item.statusMessage) {
    return `${item.statusMessage}${remaining ? ` Finalization is ${remaining}.` : ""}`;
  }

  return `The proof is accepted.${remaining ? ` Finalization is ${remaining}.` : " The challenge period is still active."}`;
}

/**
 * @param {any} item
 */
export function stageMessage(item) {
  if (item?.stage === "proven_waiting") {
    return provenWaitingMessage(item);
  }

  if (item?.stage === "ready_to_prove" && item.statusMessage) {
    return item.statusMessage;
  }

  return withdrawalStageDefaultMessage(item?.stage);
}
