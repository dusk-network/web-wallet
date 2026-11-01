/**
 * A public account's transaction history, synced from the archive by block
 * height (`@dusk-network/app-core/history`) and kept in this browser
 * (activityStore.js), with what it reads of `.dusk` name calls. The shielded
 * history is shieldedHistory.js's.
 */

import { createArchive, createHistory } from "@dusk-network/app-core/history";
import { nameCall } from "@duskdomains/sdk/call-facts";
import { get } from "svelte/store";

import { bridgeNetwork } from "$lib/bridge/bridgeCalls";
import nodeNetwork from "$lib/stores/nodeNetwork";

import * as store from "./activityStore";

/**
 * The network a history belongs to: Mainnet and Testnet by name, as the
 * chain ID the node gives names them, so a custom node of a network shares
 * its history; any other node by its base URL, with its path.
 *
 * @param {string} nodeUrl
 */
export function activityNetworkKey(nodeUrl) {
  const name = get(nodeNetwork)?.name;

  if (name === "mainnet" || name === "testnet") {
    return name;
  }

  try {
    const url = new URL(String(nodeUrl));

    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return String(nodeUrl ?? "");
  }
}

/**
 * The archive at a node's base URL. A node that answered without it is
 * asked nothing for an hour, as this browser keeps it.
 *
 * @param {string} url
 */
export const archiveAt = (url) =>
  createArchive({
    refusals: { get: store.getArchiveRefusal, put: store.putArchiveRefusal },
    url,
  });

/**
 * What a call to Dusk Domains on the node's network is, as `nameCall` reads
 * it: a registration with the account that sent it says whether it reveals
 * that account's reservation. Null for any other call.
 *
 * @param {import("@duskdomains/sdk/call-facts").ContractCall} call
 * @param {string} [sender]
 */
const nameCallOf = (call, sender) =>
  nameCall(call, get(nodeNetwork)?.name ?? "", sender);

/**
 * What the history reads of a `.dusk` name's reservation and registration,
 * checked against the account whose history it is: read again from one read
 * before the history checked them. Before its details, a call is known by
 * the contract it paid a deposit.
 *
 * @type {import("@dusk-network/app-core/history").CallFacts}
 */
const NAME_CALLS = {
  read(call, account) {
    const name = nameCallOf(call, account);

    if (name?.kind === "registration") {
      return { nameCommit: name, registeredName: name.name ?? null };
    }

    return name?.kind === "reservation" ? { nameCommit: name } : {};
  },
  wants(entry) {
    const { contractId, counterparty, detailsAt, fnName } = entry;
    const { kind } =
      nameCallOf({
        contractId: String(contractId ?? counterparty ?? ""),
        fnName: String(fnName ?? ""),
      }) ?? {};
    const commit = /** @type {ActivityNameFacts["nameCommit"]} */ (
      entry.nameCommit
    );

    return (
      !commit?.kind &&
      (detailsAt
        ? kind === "reservation" || kind === "registration"
        : Boolean(kind))
    );
  },
};

/**
 * What a call to Dusk Domains on the node's network did, for History's rows
 * (`activityRows`'s `nameCall`): the name a registration registered and the
 * reservation it reveals, or a reservation's own, as the history read them.
 *
 * @type {NonNullable<import("@dusk-network/app-core/activity").ActivityInput["nameCall"]>}
 */
export function nameFacts(call, kept) {
  const kind = nameCallOf(call)?.kind;
  const commit = /** @type {ActivityNameFacts["nameCommit"]} */ (
    kept.nameCommit
  );

  return kind
    ? {
        kind,
        name: /** @type {string | null | undefined} */ (kept.registeredName),
        reservation: commit?.reservation,
      }
    : null;
}

/**
 * One account's public history on a node's network, its bridge calls read
 * on the bridge the wallet sends them to. What it keeps is tied to the
 * store's `epoch` (getActivityEpoch): after a wallet reset since, it keeps
 * nothing and rejects with StaleActivityError.
 *
 * @param {{ account: string, epoch?: number, nodeUrl: string }} options
 */
export function publicHistory({ account, epoch, nodeUrl }) {
  const network = activityNetworkKey(nodeUrl);
  const ownerKey = store.activityOwnerKey(network, account);

  return createHistory({
    account,
    archive: archiveAt(nodeUrl),
    callFacts: NAME_CALLS,
    network: bridgeNetwork(),
    // A reset node's history is forgotten, and details are kept, only while
    // `check` says, in the write's own transaction, that it's still the one
    // this run read: another tab may have started it over meanwhile.
    store: {
      clear: (check) =>
        store.clearChainActivity(network, epoch, { check, ownerKey }),
      commit: (entries, update) =>
        store.commitActivityStep(ownerKey, entries, update, epoch),
      getState: () => store.getActivityMeta(ownerKey),
      list: (options) => store.listActivityEntries(ownerKey, options),
      patch: (details, check) =>
        store.patchActivityEntries(ownerKey, details, epoch, check),
    },
  });
}

let warnedUnavailable = false;

/**
 * Says once per page that the archive is unavailable.
 *
 * @param {unknown} error
 */
export function noteActivityUnavailable(error) {
  if (warnedUnavailable) {
    return;
  }

  warnedUnavailable = true;

  console.warn(
    "Activity history is unavailable; showing this wallet's own transactions.",
    /** @type {any} */ (error)?.message ?? error
  );
}
