/**
 * Follows the transfers between Dusk and another chain that are under way,
 * as the bridge site does, with reads on that chain's RPC (the network
 * file's): a migration's receipt, and the DUSK token's transfer that pays a
 * transfer out. Nothing is read for a transfer that's done.
 */

import {
  arrivingWei,
  keepArrival,
  markMigrationConfirmed,
  markMigrationFailed,
} from "./migrationActivity";

/** `Transfer(address,address,uint256)`, an ERC-20's transfer event. */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Blocks a log search asks for at once, and windows a check searches. */
const WINDOW = 5_000n;
const WINDOWS_PER_CHECK = 8;

/** Blocks back from the estimated start, for a chain whose pace varies. */
const MARGIN = 2_000n;

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

/** @param {bigint} n */
const hex = (n) => `0x${n.toString(16)}`;

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
 * The chain's head, and the block to search for a payout from: where the
 * last check stopped, else about when the transfer was sent, from the
 * chain's pace over its last 100,000 blocks, less a margin.
 *
 * @param {ChainRpc} rpc
 * @param {number} sentAt
 * @param {string} [scanFrom]
 */
async function searchSpan(rpc, sentAt, scanFrom) {
  const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
  const head = BigInt(latest.number);

  if (scanFrom) {
    return { head, start: BigInt(scanFrom) };
  }

  const back = head > 100_000n ? 100_000n : head;
  const earlier = await rpc("eth_getBlockByNumber", [hex(head - back), false]);
  const span = Number(BigInt(latest.timestamp) - BigInt(earlier.timestamp));
  const perBlock = back > 0n && span > 0 ? span / Number(back) : 1;
  const ago = Math.max(0, Number(BigInt(latest.timestamp)) - sentAt / 1_000);
  const start = head - BigInt(Math.ceil(ago / perBlock)) - MARGIN;

  return { head, start: start > 0n ? start : 0n };
}

/**
 * The token transfer in a window of blocks that pays `to` exactly `wanted`,
 * other than those `taken`, with when its block was made; null without one.
 *
 * @param {ChainRpc} rpc
 * @param {{ from: bigint, taken: Set<string>, to: string, token: string, until: bigint, wanted: bigint }} search
 * @returns {Promise<{ arrivedAt: number | null, payout: string } | null>}
 */
async function payoutIn(rpc, { from, taken, to, token, until, wanted }) {
  /** @type {{ blockNumber: string, data: string, transactionHash: string }[]} */
  const logs =
    (await rpc("eth_getLogs", [
      {
        address: token,
        fromBlock: hex(from),
        toBlock: hex(until),
        topics: [TRANSFER_TOPIC, null, to],
      },
    ])) ?? [];
  const match = logs.find(
    (log) =>
      BigInt(log.data) === wanted &&
      !taken.has(log.transactionHash.toLowerCase())
  );

  if (!match) {
    return null;
  }

  const block = await rpc("eth_getBlockByNumber", [match.blockNumber, false]);

  return {
    arrivedAt: block?.timestamp
      ? Number(BigInt(block.timestamp)) * 1_000
      : null,
    payout: match.transactionHash.toLowerCase(),
  };
}

/**
 * Searches the transfer's chain for the token transfer that pays it out:
 * to the address its memo gives, of the amount less the bridge's fee, from
 * about when it was sent, a few windows of blocks a check. Each payout pays
 * one transfer: `taken` are those others were paid with. Where the search
 * got to, and the payout once found, are kept.
 *
 * @param {import("./migrationActivity").RouteTransfer} transfer
 * @param {{ rpc: ChainRpc, scanFrom?: string, taken?: Set<string> }} options
 * @returns {Promise<{ arrivedAt: number | null, payout: string } | null>}
 */
export async function searchArrival(
  transfer,
  { rpc, scanFrom, taken = new Set() }
) {
  const { token } = transfer.route.chain;

  if (!token) {
    return null;
  }

  const { head, start } = await searchSpan(rpc, transfer.at ?? 0, scanFrom);
  const search = {
    taken,
    to: `0x${transfer.recipient.slice(2).toLowerCase().padStart(64, "0")}`,
    token,
    wanted: arrivingWei(transfer),
  };
  let from = start;

  for (let i = 0; i < WINDOWS_PER_CHECK && from <= head; i++) {
    const until = from + WINDOW - 1n < head ? from + WINDOW - 1n : head;
    const found = await payoutIn(rpc, { ...search, from, until });

    if (found) {
      keepArrival(transfer.hash, found);

      return found;
    }

    from = until + 1n;
  }

  keepArrival(transfer.hash, { scanFrom: from.toString() });

  return null;
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
 * Follows the transfers that need a read on their chain, oldest first, one
 * at a time: a migration's receipt, and a transfer out's payout. Each
 * payout pays one transfer. Nothing is read when none does.
 *
 * @param {import("./migrationActivity").RouteTransfer[]} transfers
 * @param {Record<string, import("./migrationActivity").ArrivalSearch>} arrivals
 * @param {(url: string) => ChainRpc} [rpcFor]
 */
export async function followTransfers(transfers, arrivals, rpcFor = chainRpc) {
  const taken = new Set(
    transfers.flatMap(({ payout }) => (payout ? [payout] : []))
  );

  for (const transfer of toFollow(transfers).sort(
    (a, b) => (a.at ?? 0) - (b.at ?? 0)
  )) {
    const rpc = rpcFor(transfer.route.chain.rpcUrl);

    if (transfer.kind === "migration") {
      await checkMigration(transfer, rpc).catch(() => null);
      continue;
    }

    const found = await searchArrival(transfer, {
      rpc,
      scanFrom: arrivals[transfer.hash]?.scanFrom,
      taken,
    }).catch(() => null);

    if (found) {
      taken.add(found.payout);
    }
  }
}
