/**
 * Asking the connected EVM wallet to move to a route's chain, and whether it's
 * still to answer: until it has, the card waits, and from then on it offers to
 * ask, rather than wait for a switch nobody is making.
 */

import { switchChain } from "@wagmi/core";
import { writable } from "svelte/store";

import { wagmiConfig } from "$lib/web3/walletConnection";

const asking = writable(false);

/** The asks so far: only the last one's answer says it's over. */
let asks = 0;

/** Whether the wallet is still to answer a request to change chain. */
export const isAskingToSwitch = { subscribe: asking.subscribe };

/**
 * @param {number} chainId
 * @returns {Promise<void>}
 */
export async function askToSwitch(chainId) {
  const ask = ++asks;

  asking.set(true);

  try {
    await switchChain(wagmiConfig, { chainId });
  } catch {
    // It said no: the card offers to ask again.
  } finally {
    if (ask === asks) {
      asking.set(false);
    }
  }
}
