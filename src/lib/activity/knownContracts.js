/**
 * The contracts the history names: Dusk Domains', and the others by the
 * names their network's file gives them.
 */

import { labelFor, networks } from "@dusk-network/networks";
import { contractRole } from "@duskdomains/sdk/releases";
import { get } from "svelte/store";

import { configuredBridge } from "$lib/bridge/bridgeCalls";
import { sozuPools } from "$lib/sozu/config";

/**
 * @typedef {import("@duskdomains/sdk/call-facts").NameCall} NameCommit
 *   A name's reservation, or its registration, as `nameCall` read it: what
 *   the reservation commits to, and what the registration reveals of it
 *   once that checks out for the account that sent it.
 */

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/**
 * The name of a contract the wallet knows, as a transaction's details show
 * it: "Dusk Domains", or what the network's file calls it ("Sozu pool",
 * "DuskEVM bridge portal"); "" for any other.
 *
 * @param {unknown} contractId
 * @param {string} [network] The network's name
 */
export function contractLabel(contractId, network) {
  const id = norm(contractId);

  if (!id) {
    return "";
  }

  if (contractRole(id, network ?? "")) {
    return "Dusk Domains";
  }

  const net =
    network && Object.hasOwn(networks, network)
      ? networks[/** @type {keyof typeof networks} */ (network)]
      : null;
  const label = net ? labelFor(net, id) : null;
  const { bridge, portal } = configuredBridge();

  if (label) {
    return label;
  }

  if (id === bridge || id === portal) {
    return "DuskEVM bridge";
  }

  return get(sozuPools).has(id) ? "Sozu pool" : "";
}
