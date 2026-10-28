import { describe, expect, it } from "vitest";

import { claimDay } from "$lib/bridge/claimDate";

import {
  claimDateOf,
  stageMessage,
} from "../EvmTransactions/withdrawalPresentation";

/** Mon 2 Nov 2026, 03:20:39 UTC, as a status gives it: seconds. */
const CLAIM_AT = Date.UTC(2026, 10, 2, 3, 20, 39);
const READY_AT = String(CLAIM_AT / 1_000);
const locale = "en-GB";
const day = claimDay(CLAIM_AT, locale);

/** What the chain said about withdrawals on testnet. */
const TIME = /** @type {RouteTime} */ ({
  maturity: 604_800,
  prove: 1_700,
  seconds: 608_200,
  source: "chain",
});

/**
 * @param {Record<string, unknown>} fields
 */
function waiting(fields) {
  return {
    readyAt: null,
    readyAtExact: false,
    stage: "proven_waiting",
    ...fields,
  };
}

describe("withdrawal presentation", () => {
  it("says when a proved withdrawal can be claimed, as the chain says", () => {
    expect(
      stageMessage(waiting({ readyAt: READY_AT, readyAtExact: true }), {
        locale,
      })
    ).toBe(`Claim from ${day}`);
    expect(stageMessage(waiting({ readyAt: READY_AT }), { locale })).toBe(
      `Claim from about ${day}`
    );
    expect(
      stageMessage(waiting({ claimOverdue: true, readyAt: READY_AT }), {
        locale,
      })
    ).toBe(
      `Waiting for DuskEVM to settle this proof. Claim from ${day} at the soonest.`
    );
    expect(claimDateOf(waiting({ readyAt: READY_AT }))).toStrictEqual({
      at: CLAIM_AT,
      exact: false,
      overdue: false,
    });
  });

  it("makes no date up from a fixed wait: until the chain gives one, the Portal's wait after the proof", () => {
    expect(stageMessage(waiting({}), { locale, time: TIME })).toBe(
      "Claim 7 days after the proof at the soonest."
    );
    expect(stageMessage(waiting({}), { locale })).toBe("");
    expect(claimDateOf(waiting({}))).toBeNull();
  });

  it("says a rejected proof must be proved again", () => {
    expect(
      stageMessage(waiting({ proofRejected: true, readyAt: READY_AT }), {
        locale,
      })
    ).toBe(
      "The proof was rejected. Prove again once DuskEVM reports a new output."
    );
  });

  it("says before the proof when it can be proved and claimed, from what the chain said", () => {
    expect(
      stageMessage({ stage: "waiting_for_output" }, { locale, time: TIME })
    ).toBe(
      "Claim 7 days after you prove. You can prove about 30 minutes after sending."
    );
    expect(stageMessage({ stage: "waiting_for_output" }, { locale })).toBe(
      "Usually within an hour."
    );
    expect(
      stageMessage({ stage: "ready_to_prove" }, { locale, time: TIME })
    ).toBe(
      "Step 1 of 2. Fee from your public account. Claim 7 days after you prove."
    );
    expect(
      stageMessage(
        { stage: "ready_to_prove" },
        {
          locale,
          proveNow: { at: CLAIM_AT, exact: false, overdue: false },
          time: TIME,
        }
      )
    ).toBe(
      `Step 1 of 2. Fee from your public account. If you prove now, you can claim from about ${day}.`
    );
  });

  it("leaves the other stages' lines to the lifecycle", () => {
    expect(stageMessage({ stage: "finalized" }, { locale })).toBe("");
    expect(
      stageMessage(
        { stage: "ready_to_prove", statusMessage: "A longer explanation." },
        { locale }
      )
    ).toBe("Step 1 of 2. Fee from your public account.");
  });
});
