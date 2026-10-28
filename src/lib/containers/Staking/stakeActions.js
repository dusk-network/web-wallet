import { feeError } from "$lib/components/Stake/stakeAmount";

/**
 * Whether the stake can be unstaked and its rewards claimed, and if not,
 * why: each reason said once, in the words the overview shows. With
 * nothing staked natively and no rewards there are no buttons to explain:
 * the overview says so with the native stake.
 *
 * @param {{
 *   hasLiquid?: boolean,
 *   hasPastStaking: boolean,
 *   maxFee: bigint,
 *   publicBalance: bigint,
 *   reward: bigint,
 *   staked: bigint,
 * }} state `maxFee` is the most an unstake or a claim costs; `hasLiquid`
 *   says whether something is staked with Sozu, which these don't touch.
 * @returns {{ canClaim: boolean, canUnstake: boolean, reasons: string[] }}
 */
export function stakeActions({
  hasLiquid = false,
  hasPastStaking,
  maxFee,
  publicBalance,
  reward,
  staked,
}) {
  const when = hasLiquid ? "natively" : hasPastStaking ? "right now" : "yet";
  const hasStake = staked > 0n;
  const hasReward = reward > 0n;
  const canPay = publicBalance >= maxFee;

  /** @type {string[]} */
  const reasons = [];

  if (hasReward && !hasStake) {
    reasons.push(`Nothing staked ${when}, so there's nothing to unstake.`);
  } else if (hasStake && !hasReward) {
    reasons.push("No rewards to claim yet.");
  }

  if ((hasStake || hasReward) && !canPay) {
    reasons.push(feeError(publicBalance));
  }

  return {
    canClaim: hasReward && canPay,
    canUnstake: hasStake && canPay,
    reasons,
  };
}
