/**
 * What a call to the DuskEVM bridge's contracts on Dusk did, as the history
 * keeps it: a deposit's DuskEVM address and amount, and the amount of the
 * withdrawal a proof or a claim is for, and whom it pays. The calls are read
 * by `@dusk-network/networks/duskevm`, on the network's own bridge and
 * route: anything that doesn't decode exactly reads as nothing.
 */

import {
  decodeBridgeCall as decodeCall,
  decodeWithdrawal,
  isBridgeContract as isNetworkBridge,
} from "@dusk-network/networks/duskevm";
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
  const net = get(nodeNetwork);

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

/**
 * Whether a contract is the node's network's DuskEVM bridge or Portal.
 *
 * @param {unknown} contractId
 */
export function isBridgeContract(contractId) {
  const net = get(nodeNetwork);

  return net ? isNetworkBridge(net, contractId) : false;
}

/**
 * What a call to one of the bridge's contracts did: undefined for a call to
 * any other contract, and null for one of the bridge's calls that doesn't
 * decode exactly as the bridge writes it.
 *
 * @param {{ contractId?: string, data?: unknown, fnName?: string }} call
 *   `data` the call's arguments in hex
 * @returns {BridgeCall | null | undefined}
 */
export function decodeBridgeCall({ contractId, data, fnName }) {
  const net = get(nodeNetwork);

  if (!net || !isNetworkBridge(net, contractId)) {
    return undefined;
  }

  const call = decodeCall(net, { args: data, contractId, fnName });

  if (!call) {
    return null;
  }

  return call.kind === "deposit"
    ? { amount: String(call.amountLux), kind: "deposit", to: call.recipient }
    : {
        amount: String(call.amountWei / 1_000_000_000n),
        hash: call.hash,
        kind: call.kind,
        recipient: recipientOf(call.recipient),
        withdrawal: call.nonce.toString(16).padStart(64, "0"),
      };
}
