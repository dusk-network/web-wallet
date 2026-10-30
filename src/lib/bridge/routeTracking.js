/**
 * Follows the transfers between Dusk and another chain that are under way,
 * as the bridge site does, with reads on that chain's RPC (the network
 * file's): a migration's receipt, and the DUSK token's transfer that pays a
 * transfer out (`@dusk-network/app-core/bridge`). Nothing is read for a
 * transfer that's done.
 */

import { serviceArrivals } from "@dusk-network/app-core/bridge";
import { get } from "svelte/store";

import { archiveAt } from "$lib/activity/activityHistory";
import nodeNetwork from "$lib/stores/nodeNetwork";
import { nodeBaseUrl } from "$lib/url";

import {
  keepArrival,
  markMigrationConfirmed,
  markMigrationFailed,
} from "./migrationActivity";

/**
 * @typedef {(method: string, params: unknown[]) => Promise<any>} ChainRpc
 */

/**
 * A JSON-RPC call to a chain's RPC.
 *
 * @param {string} url
 * @param {typeof fetch} [fetchFn]
 * @returns {ChainRpc}
 */
export const chainRpc =
  (url, fetchFn = globalThis.fetch) =>
  async (method, params) => {
    const res = await fetchFn(url, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = await res.json();

    if (body?.error) {
      throw new Error(body.error.message ?? "The chain's RPC refused a read");
    }

    return body?.result;
  };

/**
 * Whether a migration's transaction went through on its chain: true once it
 * did, false when it reverted, null while it's not in a block. It's kept
 * as confirmed or failed, and not read again.
 *
 * @param {import("./migrationActivity").RouteTransfer} transfer
 * @param {ChainRpc} rpc
 */
export async function checkMigration(transfer, rpc) {
  const receipt = await rpc("eth_getTransactionReceipt", [transfer.hash]);

  if (!receipt) {
    return null;
  }

  if (receipt.status === "0x0") {
    markMigrationFailed(transfer.hash);

    return false;
  }

  markMigrationConfirmed(transfer.hash);

  return true;
}

/**
 * The transfers that need a read on their chain: migrations not in a block
 * yet, and transfers out not paid yet. A migration in a block waits for its
 * payout in the history, with no read of its own.
 *
 * @param {import("./migrationActivity").RouteTransfer[]} transfers
 */
export const toFollow = (transfers) =>
  transfers.filter(
    ({ kind, stage }) =>
      (kind === "migration" && stage === "sending") ||
      (kind === "service" && stage === "sent")
  );

/**
 * Follows the transfers that need a read on their chain: each migration's
 * receipt, oldest first, then the transfers out, all at once. Each payout
 * pays one transfer; where its search got to, and the payout once found,
 * are kept. Nothing is read when none needs it.
 *
 * @param {import("./migrationActivity").RouteTransfer[]} transfers
 * @param {Record<string, import("./migrationActivity").ArrivalSearch>} arrivals
 * @param {(url: string) => ChainRpc} [rpcFor]
 */
export async function followTransfers(transfers, arrivals, rpcFor = chainRpc) {
  const due = toFollow(transfers).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const out = due.filter(({ kind }) => kind === "service");
  const net = get(nodeNetwork);

  for (const transfer of due.filter(({ kind }) => kind === "migration")) {
    await checkMigration(transfer, rpcFor(transfer.route.chain.rpcUrl)).catch(
      () => null
    );
  }

  if (!out.length || !net) {
    return;
  }

  const found = await serviceArrivals({
    archive: archiveAt(nodeBaseUrl()),
    network: net,
    taken: transfers.flatMap(({ payout }) => (payout ? [payout] : [])),
    transfers: out.map(({ hash, route }) => ({
      hash,
      route: route.id,
      scan: arrivals[hash]?.scan,
    })),
  }).catch(() => null);

  for (const [hash, arrival] of found?.arrivals ?? []) {
    if (arrival.state === "arrived") {
      keepArrival(hash, { arrivedAt: arrival.at, payout: arrival.hash });
    } else if (arrival.scan) {
      keepArrival(hash, { scan: arrival.scan });
    }
  }
}
