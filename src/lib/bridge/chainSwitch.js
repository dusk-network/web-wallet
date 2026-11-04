/**
 * Asking the connected EVM wallet to move to a route's chain, and whether it
 * said no: the card then says so and offers to ask again, rather than wait for
 * a switch nobody is making.
 */

import { switchChain } from "@wagmi/core";
import { writable } from "svelte/store";

import { wagmiConfig } from "$lib/web3/walletConnection";

const refused = writable(false);

/** Whether the wallet turned down the last request to change chain. */
export const chainSwitchRefused = { subscribe: refused.subscribe };

/**
 * @param {number} chainId
 * @returns {Promise<void>}
 */
export async function askToSwitch(chainId) {
  refused.set(false);

  try {
    await switchChain(wagmiConfig, { chainId });
  } catch {
    refused.set(true);
  }
}

/** No chain is being asked for any more: there's nothing to ask again. */
export const forgetChainRefusal = () => refused.set(false);
