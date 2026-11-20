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

/** A time of day, as every date the wallet writes has one. */
const A_DATE = /\d:\d\d/;

/** @param {string} text */
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` as a whole value, in the sentence that says `step`: `7 days` not
 * inside `17 days`, and a claim's wait never a proof's.
 *
 * @param {string} step
 * @param {string} text
 */
const said = (step, text) =>
  new RegExp(`\\b${step}\\b[^.]*(?<![\\w.,])${escaped(text)}(?!\\w)`, "i");

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
    const exact = stageMessage(
      waiting({ readyAt: READY_AT, readyAtExact: true }),
      { locale },
    );
    const about = stageMessage(waiting({ readyAt: READY_AT }), { locale });
    const overdue = stageMessage(
      waiting({ claimOverdue: true, readyAt: READY_AT }),
      { locale },
    );

    for (const message of [exact, about, overdue]) {
      expect(message).toMatch(said("claim", day));
    }
    // That date exactly, about it, or at the soonest once it's overdue.
    expect(exact).not.toMatch(/\babout\b|\bsoonest\b/i);
    expect(about).toMatch(/\babout\b/i);
    expect(overdue).toMatch(/\bsoonest\b/i);
    expect(claimDateOf(waiting({ readyAt: READY_AT }))).toStrictEqual({
      at: CLAIM_AT,
      exact: false,
      overdue: false,
    });
  });

  it("makes no date up from a fixed wait: until the chain gives one, the Portal's wait after the proof", () => {
    const wait = stageMessage(waiting({}), { locale, time: TIME });

    expect(wait).toMatch(said("claim", "7 days"));
    expect(wait).not.toMatch(A_DATE);
    expect(stageMessage(waiting({}), { locale })).toBe("");
    expect(claimDateOf(waiting({}))).toBeNull();
  });

  it("says a rejected proof must be proved again", () => {
    const rejected = stageMessage(
      waiting({ proofRejected: true, readyAt: READY_AT }),
      { locale },
    );

    // To prove it again: not with the date of the proof rejected.
    expect(rejected).toMatch(/\breject/i);
    expect(rejected).toMatch(/\bprove\b/i);
    expect(rejected).not.toContain(day);
  });

  it("says before the proof when it can be proved and claimed, from what the chain said", () => {
    const beforeProof = stageMessage(
      { stage: "waiting_for_output" },
      { locale, time: TIME },
    );

    // Each wait with its step.
    expect(beforeProof).toMatch(said("claim", "7 days"));
    expect(beforeProof).toMatch(said("prove", "30 minutes"));

    // Without the chain's times, the usual wait, and no date.
    const unknown = stageMessage({ stage: "waiting_for_output" }, { locale });

    expect(unknown).toMatch(/\bhour\b/i);
    expect(unknown).not.toMatch(A_DATE);
    expect(
      stageMessage({ stage: "ready_to_prove" }, { locale, time: TIME }),
    ).toMatch(said("claim", "7 days"));

    // Proved now: about when it can be claimed.
    const proveNow = stageMessage(
      { stage: "ready_to_prove" },
      {
        locale,
        proveNow: { at: CLAIM_AT, exact: false, overdue: false },
        time: TIME,
      },
    );

    expect(proveNow).toMatch(said("claim", day));
    expect(proveNow).toMatch(/\babout\b/i);
  });
});
