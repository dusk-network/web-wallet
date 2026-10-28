/** The transfer contract, whose events say what moved. */
export const TRANSFER_CONTRACT = `01${"00".repeat(31)}`;

/** The stake contract. */
export const STAKE_CONTRACT = `02${"00".repeat(31)}`;

/** What a transaction did, as the history names it. */
export const TX_KIND = Object.freeze(
  /** @type {const} */ ({
    CONTRACT_CALL: "contract_call",
    SHIELD: "shield",
    STAKE: "stake",
    TRANSFER: "transfer",
    UNSHIELD: "unshield",
    UNSTAKE: "unstake",
    WITHDRAW_REWARD: "withdraw_reward",
  })
);
