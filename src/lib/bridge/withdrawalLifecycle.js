/**
 * @typedef {object} StageMetadata
 * @property {"error" | "neutral" | "success" | "warning"} badge
 * @property {string} label
 * @property {string} message
 * @property {number} progress
 */

const UNKNOWN_STAGE = /** @type {StageMetadata} */ ({
  badge: "neutral",
  label: "Status unavailable",
  message: "Withdrawal status is unavailable.",
  progress: 0,
});

/** @type {ReadonlyMap<string, StageMetadata>} */
const STAGES = new Map([
  [
    "submitted",
    {
      badge: "warning",
      label: "Confirming",
      message:
        "Waiting for the DuskEVM transaction to be confirmed and indexed.",
      progress: 0,
    },
  ],
  [
    "waiting_for_output",
    {
      badge: "warning",
      label: "Waiting for output",
      message: "The withdrawal is confirmed. Waiting for an output proposal.",
      progress: 1,
    },
  ],
  [
    "ready_to_prove",
    {
      badge: "success",
      label: "Ready to prove",
      message: "The output is available. Submit the proof on Dusk.",
      progress: 2,
    },
  ],
  [
    "prove_submitted",
    {
      badge: "warning",
      label: "Proof submitted",
      message: "The proof transaction was submitted on Dusk.",
      progress: 2,
    },
  ],
  [
    "proven_waiting",
    {
      badge: "warning",
      label: "Challenge period",
      message: "The proof is accepted. The challenge period is still active.",
      progress: 3,
    },
  ],
  [
    "ready_to_finalize",
    {
      badge: "success",
      label: "Ready to finalize",
      message:
        "The challenge period is complete. Finalize the withdrawal on Dusk.",
      progress: 4,
    },
  ],
  [
    "finalize_submitted",
    {
      badge: "warning",
      label: "Finalization submitted",
      message: "The finalization transaction was submitted on Dusk.",
      progress: 4,
    },
  ],
  [
    "finalized",
    {
      badge: "success",
      label: "Finalized",
      message: "The withdrawal has been finalized on Dusk.",
      progress: 5,
    },
  ],
  [
    "failed",
    {
      badge: "error",
      label: "Failed",
      message: "The withdrawal transaction failed on DuskEVM.",
      progress: 0,
    },
  ],
]);

export const WITHDRAWAL_TIMELINE_STEPS = Object.freeze([
  "Initiated",
  "Output available",
  "Prove withdrawal",
  "Challenge period",
  "Finalized",
]);

/**
 * @param {string} stage
 */
function stageMetadata(stage) {
  return STAGES.get(stage) ?? UNKNOWN_STAGE;
}

/**
 * @param {string} stage
 */
export function withdrawalStageLabel(stage) {
  return stageMetadata(stage).label;
}

/**
 * @param {string} stage
 */
export function withdrawalStageBadge(stage) {
  return stageMetadata(stage).badge;
}

/**
 * @param {string} stage
 */
export function withdrawalStageDefaultMessage(stage) {
  return stageMetadata(stage).message;
}

/**
 * @param {string} stage
 */
export function withdrawalStageProgress(stage) {
  return stageMetadata(stage).progress;
}
