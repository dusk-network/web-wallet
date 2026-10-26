import { describe, expect, it } from "vitest";

import {
  WITHDRAWAL_GAS_REFUSAL,
  WITHDRAWAL_TIMELINE_STEPS,
  roughDuration,
  withdrawalActionFailure,
  withdrawalSentMessage,
  withdrawalStageDefaultMessage,
  withdrawalStageLabel,
} from "$lib/bridge/withdrawalLifecycle";

describe("DuskEVM withdrawal lifecycle", () => {
  it.each([
    ["submitted", "Processing", ""],
    ["waiting_for_output", "Not on Dusk yet", "Usually within an hour."],
    [
      "ready_to_prove",
      "Ready to prove",
      "Step 1 of 2. Fee from your public account.",
    ],
    ["prove_submitted", "Proof sent", ""],
    ["proven_waiting", "Waiting period", ""],
    [
      "ready_to_finalize",
      "Ready to claim",
      "Step 2 of 2. Fee from your public account.",
    ],
    ["finalize_submitted", "Claim sent", ""],
    ["finalized", "Done", ""],
    ["failed", "Failed", "Your DUSK is still on DuskEVM."],
  ])("labels %s as %s, with at most one short line", (stage, label, line) => {
    expect(withdrawalStageLabel(stage)).toBe(label);
    expect(withdrawalStageDefaultMessage(stage)).toBe(line);
  });

  it("names the five steps of a withdrawal", () => {
    expect(WITHDRAWAL_TIMELINE_STEPS).toEqual([
      "Sent",
      "Reported to Dusk",
      "Proved",
      "Waiting period",
      "Claimed",
    ]);
  });

  it("rounds durations to words", () => {
    expect(roughDuration(20)).toBe("a minute");
    expect(roughDuration(25 * 60)).toBe("25 minutes");
    expect(roughDuration(59.6 * 60)).toBe("an hour");
    expect(roughDuration(90 * 60)).toBe("2 hours");
    expect(roughDuration(47 * 3_600)).toBe("47 hours");
    expect(roughDuration(84 * 3_600)).toBe("4 days");
    expect(roughDuration(7 * 86_400 + 3_600)).toBe("7 days");
  });

  it("gives the total time when a withdrawal is sent, from Dusk's waiting period", () => {
    expect(withdrawalSentMessage()).toBe(
      "Two steps on Dusk, about 7 days in total."
    );
    expect(withdrawalSentMessage(604_800n)).toBe(
      "Two steps on Dusk, about 7 days in total."
    );
    expect(withdrawalSentMessage(10_800n)).toBe(
      "Two steps on Dusk, about 4 hours in total."
    );
  });

  it("says which step wasn't sent, only where it can be sent again", () => {
    expect(withdrawalActionFailure("ready_to_prove")).toBe(
      "The proof wasn't sent. Try again."
    );
    expect(withdrawalActionFailure("ready_to_finalize")).toBe(
      "The claim wasn't sent. Try again."
    );
    expect(withdrawalActionFailure("proven_waiting")).toBe("");
    expect(withdrawalActionFailure("failed")).toBe("");
  });

  it("keeps the gas refusal's own line, as trying again wouldn't help", () => {
    for (const stage of ["ready_to_prove", "ready_to_finalize"]) {
      expect(withdrawalActionFailure(stage, WITHDRAWAL_GAS_REFUSAL)).toBe(
        WITHDRAWAL_GAS_REFUSAL
      );
    }
    expect(
      withdrawalActionFailure("ready_to_finalize", "User rejected the request.")
    ).toBe("The claim wasn't sent. Try again.");
  });
});
