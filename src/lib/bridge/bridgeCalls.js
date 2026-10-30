/**
 * The DuskEVM bridge's contracts on Dusk, as set or from the network's file,
 * and what a call to them did, as the history keeps it: a deposit's DuskEVM
 * address and amount, and the amount of the withdrawal a proof or a claim is
 * for, and whom it pays.
 */

import { decodeWithdrawal } from "@dusk-network/networks/duskevm";
import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";
import { duskEvmContractId } from "$lib/web3/duskEvm";

/**
 * @typedef {{ amount: string, kind: "deposit", to: string }
 *   | { amount: string, hash?: `0x${string}`, kind: "claim" | "prove", recipient?: string | null, withdrawal: string }} BridgeCall
 *   Amounts in Lux; `to` is the DuskEVM address with its checksum,
 *   `withdrawal` the withdrawal's nonce, the same in its proof and its claim,
 *   `hash` the withdrawal's hash, which the Portal keys it by, and
 *   `recipient` whom it pays on Dusk (both missing from a call read before
 *   the history kept them).
 */

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/**
 * Whom a withdrawal pays on Dusk, as the wallet keeps it: a Dusk account, or
 * a Dusk contract's ID; null for none.
 *
 * @param {import("@dusk-network/networks/duskevm").DuskRecipient | null | undefined} recipient
 */
export const recipientOf = (recipient) =>
  recipient
    ? recipient.kind === "account"
      ? recipient.account
      : recipient.contractId
    : null;

/**
 * Whom a withdrawal pays on Dusk, as DuskEVM recorded it: null where it
 * isn't on the network's bridge route.
 *
 * @param {Parameters<typeof decodeWithdrawal>[1] | undefined} withdrawal
 * @returns {string | null}
 */
export function withdrawalRecipient(withdrawal) {
  const net = bridgeNetwork();

  return net && withdrawal
    ? recipientOf(decodeWithdrawal(net, withdrawal)?.recipient)
    : null;
}

/**
 * The bridge's contracts on Dusk, from the network's file or as set: the
 * deposit bridge and the withdrawal portal, as the history keeps contract
 * IDs.
 */
export const configuredBridge = () => ({
  bridge: norm(
    duskEvmContractId(
      "l1_standard_bridge",
      import.meta.env.VITE_BRIDGE_CONTRACT_ID
    )
  ),
  portal: norm(
    duskEvmContractId(
      "optimism_portal",
      import.meta.env.VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID
    )
  ),
});

/** @type {WeakMap<import("@dusk-network/networks").Network, import("@dusk-network/networks").Network>} */
const withSetBridge = new WeakMap();

/**
 * The node's network, with the bridge and Portal set for a local
 * deployment in place of its file's, so the history reads the calls the
 * wallet sends. Kept per network, as the settings don't change while the
 * wallet runs.
 */
export function bridgeNetwork() {
  const net = get(nodeNetwork);
  const contracts = net?.duskEvm?.contracts;

  if (!net || !contracts) {
    return net;
  }

  const { bridge, portal } = configuredBridge();
  /** @param {"l1_standard_bridge" | "optimism_portal"} name @param {string} id */
  const differs = (name, id) =>
    Boolean(id) && norm(contracts[name]?.contractId) !== id;

  if (
    !differs("l1_standard_bridge", bridge) &&
    !differs("optimism_portal", portal)
  ) {
    return net;
  }

  let set = withSetBridge.get(net);

  if (!set) {
    /** @param {"l1_standard_bridge" | "optimism_portal"} name @param {string} id */
    const as = (name, id) =>
      id ? { ...contracts[name], contractId: id } : contracts[name];

    set = /** @type {import("@dusk-network/networks").Network} */ ({
      ...net,
      duskEvm: {
        ...net.duskEvm,
        contracts: {
          ...contracts,
          ["l1_standard_bridge"]: as("l1_standard_bridge", bridge),
          ["optimism_portal"]: as("optimism_portal", portal),
        },
      },
    });
    withSetBridge.set(net, set);
  }

  return set;
}
