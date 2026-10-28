/**
 * @typedef {object} StageMetadata
 * @property {"error" | "neutral" | "success" | "warning"} badge
 * @property {string} label
 * @property {string} message
 * @property {number} progress
 */

/**
 * How long DuskEVM usually takes to report a withdrawal to Dusk. Outputs are
 * proposed about every half hour, a little behind the DuskEVM chain.
 */
export const WITHDRAWAL_REPORT_SECONDS = 3_600;

/**
 * Why a proof or claim that needs more gas than the wallet allows isn't sent.
 */
export const WITHDRAWAL_GAS_REFUSAL =
  "This withdrawal needs more gas than the wallet allows, so it wasn't sent.";

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
      label: "Processing",
      message: "",
      progress: 0,
    },
  ],
  [
    "waiting_for_output",
    {
      badge: "warning",
      label: "Not on Dusk yet",
      message: `Usually within ${roughDuration(WITHDRAWAL_REPORT_SECONDS)}.`,
      progress: 1,
    },
  ],
  [
    "ready_to_prove",
    {
      badge: "success",
      label: "Ready to prove",
      message: "Step 1 of 2. Fee from your public account.",
      progress: 2,
    },
  ],
  [
    "prove_submitted",
    {
      badge: "warning",
      label: "Proof sent",
      message: "",
      progress: 2,
    },
  ],
  [
    "proven_waiting",
    {
      badge: "warning",
      label: "Waiting period",
      message: "",
      progress: 3,
    },
  ],
  [
    "ready_to_finalize",
    {
      badge: "success",
      label: "Ready to claim",
      message: "Step 2 of 2. Fee from your public account.",
      progress: 4,
    },
  ],
  [
    "finalize_submitted",
    {
      badge: "warning",
      label: "Claim sent",
      message: "",
      progress: 4,
    },
  ],
  [
    "finalized",
    {
      badge: "success",
      label: "Done",
      message: "",
      progress: 5,
    },
  ],
  [
    "failed",
    {
      badge: "error",
      label: "Failed",
      message: "Your DUSK is still on DuskEVM.",
      progress: 0,
    },
  ],
]);

export const WITHDRAWAL_TIMELINE_STEPS = Object.freeze([
  "Sent",
  "Reported to Dusk",
  "Proved",
  "Waiting period",
  "Claimed",
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

/**
 * The line shown when the proof or the claim couldn't be sent, at the stage
 * that offers to send it again. The gas refusal keeps its own line, since
 * trying again would be refused too.
 *
 * @param {string} stage
 * @param {string} [error]
 */
export function withdrawalActionFailure(stage, error = "") {
  switch (stage) {
    case "ready_to_prove":
      return error === WITHDRAWAL_GAS_REFUSAL
        ? error
        : "The proof wasn't sent. Try again.";
    case "ready_to_finalize":
      return error === WITHDRAWAL_GAS_REFUSAL
        ? error
        : "The claim wasn't sent. Try again.";
    default:
      return "";
  }
}

/**
 * A duration in words, rounded for "about" and "within": "a minute",
 * "an hour", "7 days".
 *
 * @param {number} seconds
 */
export function roughDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));

  if (minutes < 60) {
    return minutes === 1 ? "a minute" : `${minutes} minutes`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 48) {
    return hours === 1 ? "an hour" : `${hours} hours`;
  }

  return `${Math.round(hours / 24)} days`;
}
