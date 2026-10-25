import { describe, expect, it } from "vitest";

import {
  formatClaimTime,
  stageMessage,
} from "../EvmTransactions/withdrawalPresentation";

const now = new Date(2026, 9, 25, 12, 0).getTime();
const day = 86_400_000;

/**
 * @param {Record<string, unknown>} fields
 */
function waiting(fields) {
  return {
    challengePeriodEnd: null,
    readyAt: null,
    readyAtExact: false,
    stage: "proven_waiting",
    ...fields,
  };
}

describe("withdrawal presentation", () => {
  it("formats the claim time as a short local date and time", () => {
    expect(
      formatClaimTime(new Date(2026, 9, 31, 14, 20).getTime(), "en-GB")
    ).toBe("31 Oct, 14:20");
  });

  it("gives the claim time once Dusk knows it", () => {
    const claimAt = new Date(2026, 9, 31, 14, 20).getTime();

    expect(
      stageMessage(
        waiting({ readyAt: String(claimAt / 1_000), readyAtExact: true }),
        now
      )
    ).toBe(`Claim from ${formatClaimTime(claimAt)}.`);
  });

  it("gives the time left while the claim time is an estimate", () => {
    expect(
      stageMessage(waiting({ readyAt: String((now + 6 * day) / 1_000) }), now)
    ).toBe("Claim in about 6 days.");
    expect(
      stageMessage(
        waiting({
          challengePeriodEnd: new Date(now + 3 * 3_600_000).toISOString(),
        }),
        now
      )
    ).toBe("Claim in about 3 hours.");
  });

  it("falls back to the usual waiting period without a claim time", () => {
    expect(stageMessage(waiting({}), now)).toBe("Claim in about 7 days.");
    expect(
      stageMessage(waiting({ readyAt: String((now - day) / 1_000) }), now)
    ).toBe("Claim in about 7 days.");
  });

  it("leaves the other stages' lines to the lifecycle", () => {
    expect(stageMessage({ stage: "finalized" }, now)).toBe("");
    expect(
      stageMessage(
        { stage: "ready_to_prove", statusMessage: "A longer explanation." },
        now
      )
    ).toBe("Step 1 of 2. Fee from your public account.");
  });
});
