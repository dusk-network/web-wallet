const configuredDelayThreshold = Number(
  import.meta.env.VITE_EVM_DEPOSIT_DELAY_THRESHOLD_MS
);
const DELAY_THRESHOLD_MS =
  Number.isFinite(configuredDelayThreshold) && configuredDelayThreshold > 0
    ? configuredDelayThreshold
    : 300_000;

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
        "Finalized on DuskDS. Your DUSK is secured by the bridge and is being delivered to DuskEVM. Do not submit it again.",
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
function stageMetadata(deposit, now = Date.now()) {
  if (deposit?.stage === "failed") {
    return {
      badge: /** @type {BadgeVariant} */ ("error"),
      label:
        deposit.failureLayer === "l1" ? "Failed on DuskDS" : "Delivery failed",
      message:
        deposit.failureLayer === "l1"
          ? "The DuskDS transaction failed, so the deposit did not enter the bridge."
          : "Delivery failed on DuskEVM. Do not submit the deposit again; use the transaction references when requesting bridge recovery.",
      progress: deposit.failureLayer === "l1" ? 1 : 2,
    };
  }

  if (isDepositDelayed(deposit, now)) {
    return {
      badge: /** @type {BadgeVariant} */ ("warning"),
      label: "Delayed",
      message:
        "This is taking longer than expected. The DuskDS transaction finalized and the deposit is still being tracked. Do not submit it again.",
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

/** @param {any} deposit */
export function depositStageMessage(deposit) {
  const metadata = stageMetadata(deposit);

  return deposit?.stage === "failed" || isDepositDelayed(deposit)
    ? metadata.message
    : deposit?.statusMessage || metadata.message;
}

/** @param {any} deposit */
export function depositStageProgress(deposit) {
  return stageMetadata(deposit).progress;
}

/** @param {any} deposit */
export function isDepositTerminal(deposit) {
  return deposit?.stage === "completed" || deposit?.stage === "failed";
}
