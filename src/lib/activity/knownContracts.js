/**
 * The contracts the history names, and what their calls did: Dusk Domains'
 * by what a call did to a `.dusk` name, as the explorer names them, and the
 * others by the names their network's file gives them.
 */

import { labelFor, networks } from "@dusk-network/networks";
import { get } from "svelte/store";

import { configuredBridge } from "$lib/bridge/bridgeCalls";
import releases from "$lib/dusk-domains/dusk-domains-releases.json";
import { SOZU_POOLS, sozuPools } from "$lib/sozu/config";

/**
 * Dusk Domains' contracts on each network, its lens included, as its
 * release names them.
 *
 * @type {Readonly<Record<string, Set<string>>>}
 */
export const DUSK_DOMAINS_CONTRACTS = Object.freeze(
  Object.fromEntries(
    Object.entries(releases).map(([network, release]) => [
      network,
      new Set(
        [...release.contracts, release.lens].map(({ contractId }) =>
          String(contractId).toLowerCase()
        )
      ),
    ])
  )
);

/** What a Dusk Domains call did, by its function. */
/** @type {ReadonlyMap<string, string>} */
const NAME_CALLS = new Map([
  ["clear_primary", "Cleared the primary .dusk name"],
  ["commit", "Reserved a .dusk name"],
  ["create_subname", "Created a .dusk subname"],
  ["issue_reserved", "Issued a reserved .dusk name"],
  ["mutate_records", "Changed a .dusk name's records"],
  ["register", "Registered a .dusk name"],
  ["renew", "Renewed a .dusk name"],
  ["set_primary", "Set a primary .dusk name"],
]);

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/**
 * Whether a contract is Dusk Domains': on the network, or on either one
 * the names are on when the network isn't given.
 *
 * @param {unknown} contractId
 * @param {string} [network]
 */
function isDuskDomains(contractId, network) {
  const id = norm(contractId);
  const sets =
    network === "mainnet" || network === "testnet"
      ? [DUSK_DOMAINS_CONTRACTS[network]]
      : network
        ? []
        : Object.values(DUSK_DOMAINS_CONTRACTS);

  return Boolean(id) && sets.some((set) => set.has(id));
}

/**
 * Whether a call registered a `.dusk` name.
 *
 * @param {{ contractId?: string | null, fnName?: string }} call
 */
export const isNameRegistration = ({ contractId, fnName }) =>
  String(fnName ?? "").trim() === "register" && isDuskDomains(contractId);

// A registration's arguments are rkyv: their root is their last 304 bytes,
// and the name's label sits 32 bytes into it, in place when it has up to
// 7 bytes, before the root when longer.
const REGISTRATION_ROOT = 304;
const LABEL_AT = 32;
const LABEL_INLINE = 7;
const CANONICAL_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * An archived string's bytes at `at`, in place or before `root`, where the
 * serializer puts a longer one; null where they don't lie as it puts them.
 *
 * @param {Uint8Array} args
 * @param {number} at
 * @param {number} root
 * @returns {Uint8Array | null}
 */
function stringAt(args, at, root) {
  const inlineLength = args[at + LABEL_INLINE];

  if ((inlineLength & 0x80) === 0) {
    return inlineLength <= LABEL_INLINE
      ? args.subarray(at, at + inlineLength)
      : null;
  }

  const view = new DataView(args.buffer, args.byteOffset, args.byteLength);
  const length = view.getUint32(at, true);
  const start = at + view.getInt32(at + 4, true);

  return length > LABEL_INLINE && start >= 0 && start + length <= root
    ? args.subarray(start, start + length)
    : null;
}

/**
 * The `.dusk` name a registration registered, read from its arguments:
 * undefined for any other call, and null for one whose arguments don't
 * read exactly, with a canonical label.
 *
 * @param {{ contractId?: string | null, data?: unknown, fnName?: string }} call
 *   `data` the call's arguments in hex
 * @returns {string | null | undefined}
 */
export function registeredNameOf({ contractId, data, fnName }) {
  if (!isNameRegistration({ contractId, fnName })) {
    return undefined;
  }

  const text = norm(data);
  const args = /^(?:[0-9a-f]{2})+$/.test(text)
    ? Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16))
    : new Uint8Array();
  const root = args.length - REGISTRATION_ROOT;
  const label =
    root >= 0 && root % 8 === 0 ? stringAt(args, root + LABEL_AT, root) : null;
  const spelling = label ? String.fromCharCode(...label) : "";

  return CANONICAL_LABEL.test(spelling) ? `${spelling}.dusk` : null;
}

/**
 * What a call to a contract the wallet knows did, in words, with its app;
 * null for any other contract. A registration says which name it was, once
 * that has been read from it (`registeredNameOf`).
 *
 * @param {{ contractId?: string | null, fnName?: string, registeredName?: string | null }} call
 * @param {string} [network] The network's name
 * @returns {{ app: string, label: string } | null}
 */
export function knownCall({ contractId, fnName, registeredName }, network) {
  if (!isDuskDomains(contractId, network)) {
    return null;
  }

  const fn = String(fnName ?? "").trim();

  if (fn === "register" && registeredName) {
    return { app: "Dusk Domains", label: `Registered ${registeredName}` };
  }

  return { app: "Dusk Domains", label: NAME_CALLS.get(fn) ?? "Dusk Domains" };
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

  if (isDuskDomains(id, network)) {
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

  return SOZU_POOLS.has(id) || get(sozuPools).has(id) ? "Sozu pool" : "";
}
