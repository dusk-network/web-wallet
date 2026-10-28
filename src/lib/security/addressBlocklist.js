/**
 * Recipients the wallet won't send to, as the network's file lists them
 * (`@dusk-network/networks`): on the node's network, or on any network
 * while that isn't known. A guard on this wallet's own forms only: it can't
 * stop transfers from other wallets.
 *
 * @typedef {{
 *   address: string;
 *   reason: string;
 * }} BlocklistedAddress
 */

import { blockedReason, networks } from "@dusk-network/networks";
import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";

/** What each reason the files give says. */
const REASONS = Object.freeze({
  compromised:
    "Transfer restricted: this recipient address has been reported as compromised.",
  scam: "Transfer restricted: this recipient address is associated with reported fraud/scam activity.",
});

/**
 * @param {string} address
 * @returns {BlocklistedAddress | undefined}
 */
export function getBlocklistedRecipient(address) {
  const key = typeof address === "string" ? address.trim() : "";
  const net = get(nodeNetwork);

  if (!key) {
    return undefined;
  }

  const reason = (net ? [net] : Object.values(networks))
    .map((each) => blockedReason(each, key))
    .find(Boolean);

  return reason ? { address: key, reason: REASONS[reason] } : undefined;
}
