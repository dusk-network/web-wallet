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

/** A time of day, as every date the wallet writes has one. */
const A_DATE = /\d:\d\d/;

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
    const exact = stageMessage(
      waiting({ readyAt: READY_AT, readyAtExact: true }),
      { locale },
    );
    const about = stageMessage(waiting({ readyAt: READY_AT }), { locale });
    const overdue = stageMessage(
      waiting({ claimOverdue: true, readyAt: READY_AT }),
      { locale },
    );

    // The date, said as exact, as about, or as the soonest once overdue.
    for (const message of [exact, about, overdue]) {
      expect(message).toContain(day);
    }
    expect(new Set([exact, about, overdue]).size).toBe(3);
    expect(claimDateOf(waiting({ readyAt: READY_AT }))).toStrictEqual({
      at: CLAIM_AT,
      exact: false,
      overdue: false,
    });
  });

  it("makes no date up from a fixed wait: until the chain gives one, the Portal's wait after the proof", () => {
    const wait = stageMessage(waiting({}), { locale, time: TIME });

    expect(wait).toContain("7 days");
    expect(wait).not.toMatch(A_DATE);
    expect(stageMessage(waiting({}), { locale })).toBe("");
    expect(claimDateOf(waiting({}))).toBeNull();
  });

  it("says a rejected proof must be proved again", () => {
    const rejected = stageMessage(
      waiting({ proofRejected: true, readyAt: READY_AT }),
      { locale },
    );

    // Not with the date of the proof rejected.
    expect(rejected).toMatch(/\S/);
    expect(rejected).not.toContain(day);
  });

  it("says before the proof when it can be proved and claimed, from what the chain said", () => {
    const beforeProof = stageMessage(
      { stage: "waiting_for_output" },
      { locale, time: TIME },
    );

    expect(beforeProof).toContain("7 days");
    expect(beforeProof).toContain("30 minutes");
    // Without the chain's times, no date.
    const unknown = stageMessage({ stage: "waiting_for_output" }, { locale });

    expect(unknown).toMatch(/\S/);
    expect(unknown).not.toMatch(A_DATE);
    expect(
      stageMessage({ stage: "ready_to_prove" }, { locale, time: TIME }),
    ).toContain("7 days");
    expect(
      stageMessage(
        { stage: "ready_to_prove" },
        {
          locale,
          proveNow: { at: CLAIM_AT, exact: false, overdue: false },
          time: TIME,
        },
      ),
    ).toContain(day);
  });
});
