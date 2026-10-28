import { describe, expect, it } from "vitest";

import {
  beforeProofText,
  claimDay,
  claimFrom,
  claimText,
  contractClock,
  durationWords,
  proveNowText,
  wallTime,
} from "../claimDate";

// The shared test vectors for when a DuskEVM withdrawal can be claimed, as
// the bridge runs them (`claim-date.test.js`).
//
// Testnet's deployed contracts count Dusk block height × 10. The tip, as read
// on 28 Oct 2026: block 4,704,959 at 1,793,156,989 s, so a contract time S is
// at 1,746,107,399 + S on the wall clock.
const TIP = Object.freeze({ height: 4_704_959n, timestamp: 1_793_156_989n });

// The Portal's delays and the game's clock limit, as deployed on testnet.
const TIMING = Object.freeze({
  finalitySeconds: 302_400n,
  maturitySeconds: 604_800n,
  maxClockSeconds: 302_400n,
});

// wallet-both.dusk's 1 DUSK withdrawal: proved at block 4,687,744; its game,
// created at block 4,687,605, can resolve from block 4,717,845.
const PROVEN_AT = 46_877_440n;
const GAME = Object.freeze({
  createdAt: 46_876_050n,
  resolvedAt: 0n,
  status: 0,
});

/** @param {number | null} ms */
const iso = (ms) => new Date(Number(ms)).toISOString().replace(".000", "");

/** @param {number} ms */
const when = (ms) => claimDay(ms, "en-GB", "Europe/Amsterdam");

describe("When a withdrawal can be claimed", () => {
  it("the worked example: claimable on Mon 2 Nov, 03:20 to 03:32 UTC", () => {
    // In progress: the earliest, the proof's maturity, as an estimate.
    const now = claimFrom({
      game: GAME,
      provenAt: PROVEN_AT,
      timing: TIMING,
      tip: TIP,
    });

    expect({ ...now, at: iso(now.at) }).toStrictEqual({
      at: "2026-11-02T03:20:39Z",
      exact: false,
      overdue: false,
    });

    // Resolved 139 blocks or less after its earliest: still the maturity. At
    // the resolver's median (161 blocks) and 90th percentile (205), later.
    /** @param {bigint} blocks */
    const resolvedAfter = (blocks) =>
      claimFrom({
        game: {
          ...GAME,
          resolvedAt: GAME.createdAt + TIMING.maxClockSeconds + 10n * blocks,
          status: 2,
        },
        provenAt: PROVEN_AT,
        timing: TIMING,
        tip: TIP,
      });

    expect(
      [139n, 161n, 205n].map((blocks) => iso(resolvedAfter(blocks).at))
    ).toStrictEqual([
      "2026-11-02T03:20:39Z",
      "2026-11-02T03:24:19Z",
      "2026-11-02T03:31:39Z",
    ]);
    expect(resolvedAfter(161n).exact).toBe(true);

    // As History said it, but now from the chain.
    expect(claimText(now, when)).toBe("Claim from about 2 Nov, 04:20 CET");
    expect(claimText(resolvedAfter(161n), when)).toBe(
      "Claim from 2 Nov, 04:24 CET"
    );
  });

  it("a resolved game: exact, the later of the proof's maturity and the game's finality", () => {
    // The 1,008 DUSK withdrawal: proved at block 4,525,232, its game resolved
    // at 4,555,501; claimable since block 4,585,741 (~14 Oct, 08:00 UTC).
    const game = { createdAt: 45_250_000n, resolvedAt: 45_555_010n, status: 2 };
    const claim = claimFrom({
      game,
      provenAt: 45_252_320n,
      timing: TIMING,
      tip: TIP,
    });

    expect({ ...claim, at: iso(claim.at) }).toStrictEqual({
      at: "2026-10-14T08:00:09Z",
      exact: true,
      overdue: false,
    });

    // Proving now against a resolved game: exactly the maturity from now.
    const proveNow = claimFrom({ game, timing: TIMING, tip: TIP });

    expect(proveNow.at).toBe(
      Number(TIP.timestamp + TIMING.maturitySeconds) * 1_000
    );
    // The tip is 28 Oct, 03:09:49 UTC.
    expect(proveNowText(proveNow, when)).toBe(
      "If you prove now, you can claim from 4 Nov, 04:09 CET"
    );
  });

  it("an unresolved game: the earliest it can be final, as an estimate", () => {
    // Proved long after the game was created: its finality comes first.
    const late = claimFrom({
      game: GAME,
      provenAt: 47_040_000n,
      timing: TIMING,
      tip: TIP,
    });

    expect(late.exact).toBe(false);
    expect(late.at).toBe(wallTime(47_040_000n + 604_800n, "height", TIP));

    // Proved right after: createdAt + maxClockDuration + finality is later
    // than the maturity.
    const early = claimFrom({
      game: { ...GAME, createdAt: 46_877_430n },
      provenAt: 46_877_440n,
      timing: { ...TIMING, finalitySeconds: 302_420n },
      tip: TIP,
    });

    expect(early.at).toBe(
      wallTime(46_877_430n + 302_400n + 302_420n, "height", TIP)
    );

    // Before proving, against the newest game: "If you prove now … about".
    const newest = claimFrom({
      game: { ...GAME, createdAt: 47_048_050n },
      timing: TIMING,
      tip: TIP,
    });

    expect(newest.exact).toBe(false);
    expect(proveNowText(newest, when)).toMatch(
      /^If you prove now, you can claim from about /u
    );
  });

  it("an overdue game: unresolved more than an hour past its clock, claimable at the soonest a finality from now", () => {
    const settles = GAME.createdAt + TIMING.maxClockSeconds;

    /** @param {bigint} blocksPast */
    const at = (blocksPast) => {
      const height = settles / 10n + blocksPast;

      return { height, timestamp: TIP.timestamp + 10n * (height - TIP.height) };
    };

    // An hour past (360 blocks) isn't overdue yet; a block more is.
    expect(
      claimFrom({
        game: GAME,
        provenAt: PROVEN_AT,
        timing: TIMING,
        tip: at(360n),
      }).overdue
    ).toBe(false);

    const overdue = claimFrom({
      game: GAME,
      provenAt: PROVEN_AT,
      timing: TIMING,
      tip: at(361n),
    });

    expect(overdue.overdue).toBe(true);
    expect(overdue.exact).toBe(false);
    // It could resolve now: final 3.5 days from now, after the maturity.
    expect(overdue.at).toBe(
      Number(at(361n).timestamp + TIMING.finalitySeconds) * 1_000
    );
    expect(claimText(overdue, when)).toBe(
      "Waiting for DuskEVM to settle this proof. Claim from 2 Nov, 04:57 CET at the soonest."
    );
  });

  it("a master-style deployment: block timestamps, compared strictly, so a second later", () => {
    const tip = { height: 5_600_000n, timestamp: 1_793_400_000n };
    const game = {
      createdAt: 1_792_990_000n,
      resolvedAt: 1_793_300_000n,
      status: 2,
    };

    expect(contractClock(game.createdAt, tip)).toBe("timestamp");
    expect(contractClock(GAME.createdAt, TIP)).toBe("height");

    // The proof matures at 1,793,604,800, after the game's finality at
    // 1,793,602,400: a second later.
    expect(
      claimFrom({ game, provenAt: 1_793_000_000n, timing: TIMING, tip })
    ).toStrictEqual({ at: 1_793_604_801_000, exact: true, overdue: false });

    // Resolved late: the game's finality is the later gate, a second after the delay.
    expect(
      claimFrom({
        game: { ...game, resolvedAt: 1_793_400_000n },
        provenAt: 1_793_000_000n,
        timing: TIMING,
        tip,
      }).at
    ).toBe((1_793_400_000 + 302_400 + 1) * 1_000);

    // Unresolved: an estimate, from the proof's maturity here.
    expect(
      claimFrom({
        game: { ...game, resolvedAt: 0n, status: 0 },
        provenAt: 1_793_000_000n,
        timing: TIMING,
        tip: { ...tip, timestamp: 1_793_000_100n },
      })
    ).toStrictEqual({
      at: (1_793_000_000 + 604_800 + 1) * 1_000,
      exact: false,
      overdue: false,
    });
  });

  it("gives no date when the challenger won, or the hub doesn't know the game", () => {
    const none = { at: null, exact: false, overdue: false };

    expect(
      claimFrom({
        game: { ...GAME, status: 1 },
        provenAt: PROVEN_AT,
        timing: TIMING,
        tip: TIP,
      })
    ).toStrictEqual(none);
    expect(
      claimFrom({
        game: { createdAt: 0n, resolvedAt: 0n, status: 0 },
        provenAt: PROVEN_AT,
        timing: TIMING,
        tip: TIP,
      })
    ).toStrictEqual(none);
    expect(claimText({ at: null }, when)).toBe("");
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
