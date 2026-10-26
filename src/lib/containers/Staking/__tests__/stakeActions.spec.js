import { describe, expect, it } from "vitest";

import { stakeActions } from "../stakeActions";

const DUSK = 1_000_000_000n;

describe("stakeActions", () => {
  const base = {
    hasPastStaking: false,
    maxFee: 50_000_000n,
    publicBalance: 172n * DUSK,
    reward: 0n,
    staked: 0n,
  };

  it("says once why neither can be pressed with nothing staked", () => {
    expect(stakeActions(base)).toStrictEqual({
      canClaim: false,
      canUnstake: false,
      reasons: ["Nothing staked yet, so there's nothing to unstake or claim."],
    });
    expect(
      stakeActions({ ...base, hasPastStaking: true }).reasons
    ).toStrictEqual([
      "Nothing staked right now, so there's nothing to unstake or claim.",
    ]);
  });

  it("says it of native staking when something is staked with Sozu", () => {
    expect(
      stakeActions({ ...base, hasLiquid: true, hasPastStaking: true }).reasons
    ).toStrictEqual([
      "Nothing staked natively, so there's nothing to unstake or claim.",
    ]);
  });

  it("lets rewards be claimed after unstaking, and a stake be unstaked before it earns", () => {
    expect(
      stakeActions({ ...base, hasPastStaking: true, reward: 5n * DUSK })
    ).toStrictEqual({
      canClaim: true,
      canUnstake: false,
      reasons: ["Nothing staked right now, so there's nothing to unstake."],
    });
    expect(stakeActions({ ...base, staked: 1_000n * DUSK })).toStrictEqual({
      canClaim: false,
      canUnstake: true,
      reasons: ["No rewards to claim yet."],
    });
  });

  it("says when the public balance can't pay the fee", () => {
    expect(
      stakeActions({
        ...base,
        publicBalance: 0n,
        reward: DUSK,
        staked: 1_000n * DUSK,
      })
    ).toStrictEqual({
      canClaim: false,
      canUnstake: false,
      reasons: [
        "The network fee is paid from the public balance, and it's empty.",
      ],
    });
  });
});
