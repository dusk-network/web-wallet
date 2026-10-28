import { formatTime } from "@dusk-network/networks/format";
import { get } from "svelte/store";

import {
  beforeProofText,
  claimAfterProving,
  claimDay,
  claimText,
  durationWords,
  proveNowText,
} from "$lib/bridge/claimDate";
import { withdrawalStageDefaultMessage } from "$lib/bridge/withdrawalLifecycle";
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

  return Number.isNaN(date.getTime()) ? "Pending" : formatTime(date);
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
 * A waiting withdrawal's claim date, as the chain says it (`claimFrom`):
 * exact once its game has resolved, the earliest before that, and overdue
 * when the game's resolution is late. Null until Dusk said it: no date is
 * made up from a fixed wait.
 *
 * @param {any} item
 * @returns {import("$lib/bridge/claimDate").ClaimDate | null}
 */
export function claimDateOf(item) {
  return item?.readyAt
    ? {
        at: Number(item.readyAt) * 1_000,
        exact: Boolean(item.readyAtExact),
        overdue: Boolean(item.claimOverdue),
      }
    : null;
}

/**
 * @typedef {{
 *   locale?: string,
 *   proveNow?: import("$lib/bridge/claimDate").ClaimDate | null,
 *   time?: RouteTime | null,
 * }} StageMessageOptions
 *   `time` is what the chain said about withdrawals (`routeTime`), and
 *   `proveNow` when the withdrawal can be claimed if it's proved now.
 */

/**
 * The line under a proved withdrawal's step: when it can be claimed, as
 * the chain says, or, until that's read, the Portal's wait after the proof.
 * A rejected proof can't be claimed.
 *
 * @param {any} item
 * @param {(ms: number) => string} when
 * @param {RouteTime | null | undefined} time
 */
function waitingMessage(item, when, time) {
  if (item.proofRejected) {
    return "The proof was rejected. Prove again once DuskEVM reports a new output.";
  }

  return (
    claimText(claimDateOf(item), when) ||
    (time?.maturity
      ? `Claim ${durationWords(time.maturity)} after the proof at the soonest.`
      : "")
  );
}

/**
 * Before the proof: when it can be claimed if it's proved now, or the
 * Portal's wait after a proof.
 *
 * @param {(ms: number) => string} when
 * @param {StageMessageOptions} options
 */
function provingMessage(when, { proveNow, time }) {
  const step = withdrawalStageDefaultMessage("ready_to_prove");

  if (proveNow?.at) {
    return `${step} ${proveNowText(proveNow, when)}.`;
  }

  return time?.maturity ? `${step} ${claimAfterProving(time.maturity)}` : step;
}

/**
 * The line under a withdrawal's current step.
 *
 * @param {any} item
 * @param {StageMessageOptions} [options]
 */
export function stageMessage(item, options = {}) {
  const locale = options.locale ?? get(settingsStore).language;
  const when = (/** @type {number} */ ms) => claimDay(ms, locale);

  switch (item?.stage) {
    case "proven_waiting":
      return waitingMessage(item, when, options.time);
    case "ready_to_prove":
      return provingMessage(when, options);
    case "submitted":
    case "waiting_for_output":
      return (
        beforeProofText(options.time) ||
        withdrawalStageDefaultMessage(item.stage)
      );
    default:
      return withdrawalStageDefaultMessage(item?.stage);
  }
}
