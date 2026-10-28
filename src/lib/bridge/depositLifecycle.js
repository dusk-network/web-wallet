import { routeTimeText } from "./routeTimes";

const configuredDelayThreshold = Number(
  import.meta.env.VITE_EVM_DEPOSIT_DELAY_THRESHOLD_MS
);
const DELAY_THRESHOLD_MS =
  Number.isFinite(configuredDelayThreshold) && configuredDelayThreshold > 0
    ? configuredDelayThreshold
    : 300_000;
const configuredStallThreshold = Number(
  import.meta.env.VITE_EVM_DEPOSIT_STALL_THRESHOLD_MS
);
const STALL_THRESHOLD_MS =
  Number.isFinite(configuredStallThreshold) && configuredStallThreshold > 0
    ? configuredStallThreshold
    : 1_800_000;

/** @typedef {"neutral" | "success" | "warning" | "error"} BadgeVariant */

export const DEPOSIT_TIMELINE_STEPS = Object.freeze([
  "Submitted",
  "Finalized on DuskDS",
  "Bridging to DuskEVM",
  "Available on DuskEVM",
]);

const STAGES = new Map([
  [
    "l1_pending",
    {
      badge: "warning",
      label: "Confirming",
      message: "Waiting for DuskDS to finalize the transaction.",
      progress: 1,
    },
  ],
  [
    "l2_pending",
    {
      badge: "warning",
      label: "Bridging",
      message:
        "Finalized on DuskDS, on its way to DuskEVM. Don't send it again.",
      progress: 2,
    },
  ],
  [
    "completed",
    {
      badge: "success",
      label: "Available",
      message: "The deposit is available on DuskEVM.",
      progress: DEPOSIT_TIMELINE_STEPS.length,
    },
  ],
]);

const UNKNOWN_STAGE = {
  badge: "neutral",
  label: "Status unavailable",
  message: "The deposit status is unavailable.",
  progress: 0,
};

/**
 * @param {any} deposit
 * @param {number} [now]
 */
export function isDepositDelayed(deposit, now = Date.now()) {
  return (
    deposit?.stage === "l2_pending" &&
    Number.isFinite(deposit?.l1ConfirmedAt ?? deposit?.createdAt) &&
    now - (deposit.l1ConfirmedAt ?? deposit.createdAt) >= DELAY_THRESHOLD_MS
  );
}

/**
 * @param {any} deposit
 * @param {number} [now]
 */
export function isDepositStalled(deposit, now = Date.now()) {
  return (
    !isDepositTerminal(deposit) &&
    Number.isFinite(deposit?.progressedAt ?? deposit?.createdAt) &&
    now - (deposit.progressedAt ?? deposit.createdAt) >= STALL_THRESHOLD_MS
  );
}

/**
 * @param {any} deposit
 * @param {number} [now]
 */
function stageMetadata(deposit, now = Date.now()) {
  if (deposit?.stage === "failed") {
    return {
      badge: /** @type {BadgeVariant} */ ("error"),
      label:
        deposit.failureLayer === "l1" ? "Failed on DuskDS" : "Delivery failed",
      message:
        deposit.failureLayer === "l1"
          ? "The DuskDS transaction failed, so the deposit did not enter the bridge."
          : "Delivery failed on DuskEVM. Don't send it again; give these transactions when you ask for bridge recovery.",
      progress: deposit.failureLayer === "l1" ? 1 : 2,
    };
  }

  if (isDepositStalled(deposit, now)) {
    return {
      badge: /** @type {BadgeVariant} */ ("warning"),
      label: "Tracking delayed",
      message:
        "No progress seen lately. Still followed, less often; don't send it again.",
      progress: deposit?.stage === "l2_pending" ? 2 : 1,
    };
  }

  if (isDepositDelayed(deposit, now)) {
    return {
      badge: /** @type {BadgeVariant} */ ("warning"),
      label: "Delayed",
      message: "Taking longer than usual. Still followed; don't send it again.",
      progress: 2,
    };
  }

  return STAGES.get(deposit?.stage) ?? UNKNOWN_STAGE;
}

/**
 * @param {any} deposit
 * @returns {BadgeVariant}
 */
export function depositStageBadge(deposit) {
  return /** @type {BadgeVariant} */ (stageMetadata(deposit).badge);
}

/** @param {any} deposit */
export function depositStageLabel(deposit) {
  return stageMetadata(deposit).label;
}

/**
 * What a deposit's stage says. On its way, with how long a deposit takes on
 * this network (`time`) where that's known.
 *
 * @param {any} deposit
 * @param {{ time?: RouteTime | null }} [options]
 */
export function depositStageMessage(deposit, { time = null } = {}) {
  const metadata = stageMetadata(deposit);

  if (
    deposit?.stage === "failed" ||
    isDepositDelayed(deposit) ||
    isDepositStalled(deposit)
  ) {
    return metadata.message;
  }

  if (deposit?.stage === "l2_pending" && time) {
    return `Finalized on DuskDS. Arrives on DuskEVM in ${routeTimeText(time)}. Don't send it again.`;
  }

  return deposit?.statusMessage || metadata.message;
}

/** @param {any} deposit */
export function depositStageProgress(deposit) {
  return stageMetadata(deposit).progress;
}

/** @param {any} deposit */
export function isDepositTerminal(deposit) {
  return deposit?.stage === "completed" || deposit?.stage === "failed";
}
