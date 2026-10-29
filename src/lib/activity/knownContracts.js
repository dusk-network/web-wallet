/**
 * The contracts the history names, and what their calls did: Dusk Domains'
 * by what a call did to a `.dusk` name, as the explorer names them, and the
 * others by the names their network's file gives them.
 */

import { labelFor, networks } from "@dusk-network/networks";
import { nameCall } from "@duskdomains/sdk/call-facts";
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

/** What a Dusk Domains call did, by what it is. */
/** @type {Readonly<Record<string, string>>} */
const NAME_CALLS = Object.freeze({
  issue: "Issued a reserved .dusk name",
  "primary-cleared": "Cleared the primary .dusk name",
  "primary-set": "Set a primary .dusk name",
  records: "Changed a .dusk name's records",
  registration: "Registered a .dusk name",
  renewal: "Renewed a .dusk name",
  reservation: "Name reservation (step 1 of 2)",
  subname: "Created a .dusk subname",
});

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/**
 * What a call to a contract the wallet knows did, in words, with its app;
 * null for any other contract. A registration says which name it was, once
 * that has been read from it, and a reservation the name its registration
 * revealed, where there's one (`reservedName`).
 *
 * @param {{ contractId?: string | null, fnName?: string, registeredName?: string | null, reservedName?: string | null }} call
 * @param {string} [network] The network's name
 * @returns {{ app: string, label: string } | null}
 */
export function knownCall(
  { contractId, fnName, registeredName, reservedName },
  network
) {
  const { kind } =
    nameCall(
      { contractId: norm(contractId), fnName: String(fnName ?? "").trim() },
      network ?? ""
    ) ?? {};

  if (!kind) {
    return null;
  }

  const label =
    kind === "registration" && registeredName
      ? `Registered ${registeredName}`
      : kind === "reservation" && reservedName
        ? `Reserved ${reservedName}`
        : (NAME_CALLS[kind] ?? "Dusk Domains");

  return { app: "Dusk Domains", label };
}

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
