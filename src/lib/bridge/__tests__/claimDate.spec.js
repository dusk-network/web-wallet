import { describe, expect, it } from "vitest";
import { claimFrom } from "@dusk-network/networks/duskevm";

import {
  beforeProofText,
  claimDay,
  claimText,
  durationWords,
  proveNowText,
} from "../claimDate";

// The dates come from @dusk-network/networks/duskevm, from the shared test
// vectors: testnet's deployed contracts count Dusk block height × 10, and
// the tip, as read on 28 Oct 2026, is block 4,704,959 at 1,793,156,989 s.
const TIP = Object.freeze({ height: 4_704_959n, timestamp: 1_793_156_989n });

// The Portal's delays, as deployed on testnet.
const PORTAL = Object.freeze({
  disputeGameFinalityDelaySeconds: 302_400n,
  proofMaturityDelaySeconds: 604_800n,
});

// wallet-both.dusk's 1 DUSK withdrawal: proved at block 4,687,744; its game,
// created at block 4,687,605, can resolve from block 4,717,845.
const PROVEN_AT = 46_877_440n;
const GAME = Object.freeze({
  createdAt: 46_876_050n,
  maxClockDuration: 302_400n,
  resolvedAt: 0n,
  status: 0,
});

/** @param {number} ms */
const when = (ms) => claimDay(ms, "en-GB", "Europe/Amsterdam");

describe("A claim date in words", () => {
  it("says when a withdrawal can be claimed: about, until its game resolves", () => {
    const now = claimFrom({
      game: GAME,
      portal: PORTAL,
      provenAt: PROVEN_AT,
      tip: TIP,
    });
    // Resolved at the resolver's median, 161 blocks after its earliest.
    const resolved = claimFrom({
      game: {
        ...GAME,
        resolvedAt: GAME.createdAt + GAME.maxClockDuration + 1_610n,
        status: 2,
      },
      portal: PORTAL,
      provenAt: PROVEN_AT,
      tip: TIP,
    });

    expect(claimText(now, when)).toBe("Claim from about 2 Nov, 04:20 CET");
    expect(claimText(resolved, when)).toBe("Claim from 2 Nov, 04:24 CET");
    expect(claimText({ at: null }, when)).toBe("");
  });

  it("says when its game is late to resolve", () => {
    const settles = GAME.createdAt + GAME.maxClockDuration;
    // A block more than an hour (360 blocks) past its clock.
    const height = settles / 10n + 361n;
    const overdue = claimFrom({
      game: GAME,
      portal: PORTAL,
      provenAt: PROVEN_AT,
      tip: { height, timestamp: TIP.timestamp + 10n * (height - TIP.height) },
    });

    expect(claimText(overdue, when)).toBe(
      "Waiting for DuskEVM to settle this proof. Claim from 2 Nov, 04:57 CET at the soonest."
    );
  });

  it("says when a proof made now could be claimed", () => {
    // Against a resolved game: exactly the maturity from now.
    const resolved = claimFrom({
      game: { ...GAME, resolvedAt: 45_555_010n, status: 2 },
      portal: PORTAL,
      tip: TIP,
    });
    // Against the newest game: an estimate.
    const newest = claimFrom({
      game: { ...GAME, createdAt: 47_048_050n },
      portal: PORTAL,
      tip: TIP,
    });

    // The tip is 28 Oct, 03:09:49 UTC.
    expect(proveNowText(resolved, when)).toBe(
      "If you prove now, you can claim from 4 Nov, 04:09 CET"
    );
    expect(proveNowText(newest, when)).toMatch(
      /^If you prove now, you can claim from about /u
    );
    expect(proveNowText(null, when)).toBe("");
  });

  it("says the wait before the proof from what the chain said", () => {
    expect(beforeProofText({ maturity: 604_800, prove: 1_700 })).toBe(
      "Claim 7 days after you prove. You can prove about 30 minutes after sending."
    );
    expect(beforeProofText({ maturity: 302_400 })).toBe(
      "Claim 3 days 12 hours after you prove."
    );
    expect(beforeProofText(null)).toBe("");
    expect(
      [59, 60, 5_400, 90_000].map((seconds) => durationWords(seconds))
    ).toStrictEqual([
      "less than a minute",
      "1 minute",
      "1 hour 30 minutes",
      "1 day 1 hour",
    ]);
  });
});
