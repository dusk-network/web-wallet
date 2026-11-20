import { describe, expect, it } from "vitest";

import { stakeActions } from "../stakeActions";

const DUSK = 1_000_000_000n;

/**
 * Matches `value` whole: not inside a longer figure, so "1 DUSK" matches
 * neither "11 DUSK" nor "0.1 DUSK".
 *
 * @param {string} value As the page writes it, as "0.05 DUSK"
 */
const wholeFigure = (value) =>
  new RegExp(`(?<![^ ])${value.replaceAll(".", "[.]")}(?![.,]?[0-9])`);

/** Why Unstake is off, and why Claim is, by their key words. */
const noUnstake = expect.stringMatching(/unstake/);
const noClaim = expect.stringMatching(/claim/);

describe("stakeActions", () => {
  const base = {
    hasPastStaking: false,
    maxFee: 50_000_000n,
    publicBalance: 172n * DUSK,
    reward: 0n,
    staked: 0n,
  };

  it("gives no reasons with nothing staked natively: no button shows to explain", () => {
    expect(stakeActions(base)).toStrictEqual({
      canClaim: false,
      canUnstake: false,
      reasons: [],
    });
    expect(
      stakeActions({ ...base, hasLiquid: true, hasPastStaking: true }).reasons,
    ).toStrictEqual([]);
  });

  it("says it of native staking when something is staked with Sozu", () => {
    expect(
      stakeActions({
        ...base,
        hasLiquid: true,
        hasPastStaking: true,
        reward: DUSK,
      }).reasons,
    ).toStrictEqual([expect.stringMatching(/natively/)]);
  });

  it("lets rewards be claimed after unstaking, and a stake be unstaked before it earns", () => {
    expect(
      stakeActions({ ...base, hasPastStaking: true, reward: 5n * DUSK }),
    ).toStrictEqual({
      canClaim: true,
      canUnstake: false,
      reasons: [noUnstake],
    });
    expect(stakeActions({ ...base, staked: 1_000n * DUSK })).toStrictEqual({
      canClaim: false,
      canUnstake: true,
      reasons: [noClaim],
    });
  });

  it("offers neither, and says nothing of why, while a staking transaction is pending", () => {
    expect(
      stakeActions({
        ...base,
        pending: true,
        reward: 5n * DUSK,
        staked: 1_000n * DUSK,
      }),
    ).toStrictEqual({ canClaim: false, canUnstake: false, reasons: [] });
  });

  it("lets one go on to the form while the balance can pay the least its fee can be lowered to", () => {
    const short = {
      ...base,
      leastFee: 35_000_000n,
      reward: DUSK,
      staked: 1_000n * DUSK,
    };

    expect(
      stakeActions({ ...short, publicBalance: 40_000_000n }),
    ).toStrictEqual({ canClaim: true, canUnstake: true, reasons: [] });
    expect(
      stakeActions({ ...short, publicBalance: 30_000_000n }),
    ).toMatchObject({ canClaim: false, canUnstake: false });
  });

  it("says when the public balance can't pay the fee, and how much is missing, but for what would give it away", () => {
    expect(
      stakeActions({
        ...base,
        publicBalance: 0n,
        reward: DUSK,
        staked: 1_000n * DUSK,
      }),
    ).toStrictEqual({
      canClaim: false,
      canUnstake: false,
      reasons: [expect.stringMatching(wholeFigure("0.05 DUSK"))],
    });
    expect(
      stakeActions({
        ...base,
        publicBalance: 40_000_000n,
        reward: DUSK,
        staked: 1_000n * DUSK,
      }).reasons,
    ).toStrictEqual([expect.stringMatching(wholeFigure("0.01 DUSK"))]);

    // With balances hidden, the figure, which gives the balance away, isn't.
    const hidden = stakeActions({
      ...base,
      hidden: true,
      publicBalance: 40_000_000n,
      reward: DUSK,
      staked: 1_000n * DUSK,
    }).reasons;

    expect(hidden).toStrictEqual([expect.stringMatching(/fee/)]);
    expect(hidden[0]).not.toMatch(/[0-9]/);
  });
});
