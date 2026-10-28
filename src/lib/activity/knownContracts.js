/**
 * The contracts the history names, and what their calls did: Dusk Domains'
 * by what a call did to a `.dusk` name, as the explorer names them, and the
 * bridge's and Sozu's by their app.
 */

import { configuredBridge } from "$lib/bridge/bridgeCalls";
import { SOZU_POOLS, sozuPools } from "$lib/sozu/config";
import { get } from "svelte/store";

/**
 * Dusk Domains' contracts on each network, its lens included, as its
 * release names them (dusk-domains-releases.json).
 */
export const DUSK_DOMAINS_CONTRACTS = Object.freeze({
  mainnet: new Set([
    "338f0e85593d75df128fe17bde2c4c6b391133c8b920d7e8c7e38902bf3abad2",
    "aaaefaf86e0df54e6cc6680d49b7abb934f3252deb4d6383d393f8dacb2c814f",
    "30f9078d7b27a4060d5c9a59840de4b6d4eb0ec0b5f0db9de22e4e1f817f0869",
    "33bd9ec8c70425f1a60c8a9e2fc860f15b822a3fcd2cf72b02b515a926de2b50",
    "d8c003e0788548cb78ae029f0d7cfeb91aebc992a9ab200b31ac8967e35842b8",
    "e6cea1e703a0bda45f96575db3009e69be5446d43a593ab8a381520b8dc6ba18",
    "461cc0b23e275f3971710b02367942f80f4542c772b069bd84848e4eb836a388",
  ]),
  testnet: new Set([
    "8ca33cf5d112a33d5798a416dbf25fe0a2f410263b71491ff1e1d4b65d695473",
    "007735c48c19c1547ab778db41da8604e5a3e44af3c42ab45dc7ec3c965156ce",
    "93a7c5b07586e01305d1ada1bfde400bcb5e101ebdb941c6a3f2a8253265f92a",
    "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199",
    "761c3a20774e87f0bc9fd446f160abd3c7b3c91b75a63ee6c2f21f0afd9c763d",
    "2940cb5cd72634be3e881ec6921a44c80393d6bb2d6e3a19cffd847594d26170",
    "7cb8b9dbd233657aa21d6dd77a4fb24261726d4a5a49d7ec8a246d8350cac913",
  ]),
});

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
 * it: "Dusk Domains", "DuskEVM bridge" or "Sozu"; "" for any other.
 *
 * @param {unknown} contractId
 * @param {string} [network] The network's name
 */
export function contractLabel(contractId, network) {
  const id = norm(contractId);
  const { bridge, portal } = configuredBridge();

  if (!id) {
    return "";
  }

  if (isDuskDomains(id, network)) {
    return "Dusk Domains";
  }

  if (id === bridge || id === portal) {
    return "DuskEVM bridge";
  }

  return SOZU_POOLS.has(id) || get(sozuPools).has(id) ? "Sozu" : "";
}
