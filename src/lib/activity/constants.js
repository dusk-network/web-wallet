import { networks } from "@dusk-network/networks";

/**
 * The transfer contract, whose events say what moved, and the stake
 * contract: the same on every Dusk network, as each network's file has them.
 */
export const { stake: STAKE_CONTRACT, transfer: TRANSFER_CONTRACT } =
  networks.mainnet.contracts;

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
