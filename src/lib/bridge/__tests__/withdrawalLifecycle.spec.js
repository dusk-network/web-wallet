import { describe, expect, it } from "vitest";

import {
  WITHDRAWAL_GAS_REFUSAL,
  WITHDRAWAL_TIMELINE_STEPS,
  roughDuration,
  withdrawalActionFailure,
  withdrawalStageDefaultMessage,
  withdrawalStageLabel,
} from "$lib/bridge/withdrawalLifecycle";

/** A line, whatever its words. */
const SAYS = expect.stringMatching(/\S/);

describe("DuskEVM withdrawal lifecycle", () => {
  it.each([
    ["submitted", ""],
    ["waiting_for_output", SAYS],
    ["ready_to_prove", SAYS],
    ["prove_submitted", ""],
    ["proven_waiting", ""],
    ["ready_to_finalize", SAYS],
    ["finalize_submitted", ""],
    ["finalized", ""],
    // Where the DUSK is.
    ["failed", expect.stringContaining("DuskEVM")],
  ])("labels %s, with at most one short line", (stage, line) => {
    expect(withdrawalStageLabel(stage)).toMatch(/\S/);
    expect(withdrawalStageDefaultMessage(stage)).toEqual(line);
  });

  it("names the five steps of a withdrawal", () => {
    expect(WITHDRAWAL_TIMELINE_STEPS).toHaveLength(5);
  });

  it("rounds durations to words", () => {
    expect(roughDuration(20)).toMatch(/minute$/);
    expect(roughDuration(25 * 60)).toBe("25 minutes");
    expect(roughDuration(59.6 * 60)).toMatch(/hour$/);
    expect(roughDuration(90 * 60)).toBe("2 hours");
    expect(roughDuration(47 * 3_600)).toBe("47 hours");
    expect(roughDuration(84 * 3_600)).toBe("4 days");
    expect(roughDuration(7 * 86_400 + 3_600)).toBe("7 days");
  });

  it("says which step wasn't sent, only where it can be sent again", () => {
    const proof = withdrawalActionFailure("ready_to_prove");
    const claim = withdrawalActionFailure("ready_to_finalize");

    expect(proof).toMatch(/\S/);
    expect(claim).toMatch(/\S/);
    expect(proof).not.toBe(claim);
    expect(withdrawalActionFailure("proven_waiting")).toBe("");
    expect(withdrawalActionFailure("failed")).toBe("");
  });

  it("keeps the gas refusal's own line, as trying again wouldn't help", () => {
    for (const stage of ["ready_to_prove", "ready_to_finalize"]) {
      expect(withdrawalActionFailure(stage, WITHDRAWAL_GAS_REFUSAL)).toBe(
        WITHDRAWAL_GAS_REFUSAL,
      );
    }
    expect(
      withdrawalActionFailure(
        "ready_to_finalize",
        "User rejected the request.",
      ),
    ).toBe(withdrawalActionFailure("ready_to_finalize"));
  });
});
