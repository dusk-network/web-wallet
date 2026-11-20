import { describe, expect, it } from "vitest";

import {
  WITHDRAWAL_GAS_REFUSAL,
  WITHDRAWAL_TIMELINE_STEPS,
  roughDuration,
  withdrawalActionFailure,
  withdrawalStageDefaultMessage,
  withdrawalStageLabel,
} from "$lib/bridge/withdrawalLifecycle";

describe("DuskEVM withdrawal lifecycle", () => {
  it.each([
    ["submitted", /processing/i, ""],
    ["waiting_for_output", /not on dusk/i, /\bhour\b/i],
    // Its step, and the balance its fee comes from.
    ["ready_to_prove", /ready to prove/i, /\b2 of 3\b.*\bpublic\b/i],
    ["prove_submitted", /proof sent/i, ""],
    ["proven_waiting", /waiting/i, ""],
    ["ready_to_finalize", /ready to claim/i, /\b3 of 3\b.*\bpublic\b/i],
    ["finalize_submitted", /claim sent/i, ""],
    ["finalized", /done/i, ""],
    // Where the DUSK is.
    ["failed", /failed/i, /still on DuskEVM/i],
  ])(
    "labels %s as its state, with at most one short line",
    (stage, label, line) => {
      expect(withdrawalStageLabel(stage)).toMatch(label);
      expect(withdrawalStageDefaultMessage(stage)).toEqual(
        line === "" ? "" : expect.stringMatching(line),
      );
    },
  );

  it("names the five steps of a withdrawal, in their order", () => {
    expect(WITHDRAWAL_TIMELINE_STEPS).toEqual([
      expect.stringMatching(/sent/i),
      expect.stringMatching(/report/i),
      expect.stringMatching(/prove/i),
      expect.stringMatching(/wait/i),
      expect.stringMatching(/claim/i),
    ]);
  });

  it("rounds durations to words", () => {
    expect(roughDuration(20)).toMatch(/^(?:a|one|1) minute$/i);
    expect(roughDuration(25 * 60)).toBe("25 minutes");
    expect(roughDuration(59.6 * 60)).toMatch(/^(?:an|one|1) hour$/i);
    expect(roughDuration(90 * 60)).toBe("2 hours");
    expect(roughDuration(47 * 3_600)).toBe("47 hours");
    expect(roughDuration(84 * 3_600)).toBe("4 days");
    expect(roughDuration(7 * 86_400 + 3_600)).toBe("7 days");
  });

  it("says which step wasn't sent, only where it can be sent again", () => {
    const proof = withdrawalActionFailure("ready_to_prove");
    const claim = withdrawalActionFailure("ready_to_finalize");

    // The step it was, and that it didn't go out.
    expect(proof).toMatch(/\bproof\b/i);
    expect(proof).not.toMatch(/\bclaim\b/i);
    expect(claim).toMatch(/\bclaim\b/i);
    expect(claim).not.toMatch(/\bproof\b/i);
    for (const line of [proof, claim]) {
      expect(line).toMatch(/wasn't sent/i);
    }
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
