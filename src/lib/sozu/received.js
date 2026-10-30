/**
 * The stDUSK a stake with Sozu got, read once from the chain: the pool's
 * `deposit` event in the stake's block gives the DUSK staked, Sozu's fee
 * and the pool's stake and stDUSK at that moment, from which its contract
 * minted the staker's stDUSK.
 */

import { archiveAt } from "$lib/activity/activityHistory";

import { stDuskFor } from "@dusk-network/networks/sozu";
import { loadSozuDriver } from "./status";

const ID = /^[0-9a-f]{64}$/;

/** @param {unknown} id */
const norm = (id) =>
  String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");

/** @param {unknown} value */
const lux = (value) => {
  try {
    const amount = BigInt(String(value));

    return amount >= 0n ? amount : null;
  } catch {
    return null;
  }
};

/** What each stake got, by its transaction: read once a visit. */
/** @type {Map<string, Promise<bigint | null>>} */
const received = new Map();

/**
 * What a stake with Sozu got, in stDUSK lux: null when its event can't be
 * found or read. The block's events are one request, made once per stake.
 *
 * @param {string} nodeUrl
 * @param {{ blockHeight?: number | null, contractId?: string | null, hash: string }} stake
 *   Its transaction, its block and the pool it called
 * @param {{ driver?: () => Promise<SozuDriver> }} [options]
 * @returns {Promise<bigint | null>}
 */
export function stDuskReceived(
  nodeUrl,
  { blockHeight, contractId, hash },
  { driver = () => loadSozuDriver("sozu_pool") } = {}
) {
  const pool = norm(contractId);
  const tx = norm(hash);

  if (
    !ID.test(pool) ||
    !ID.test(tx) ||
    !Number.isSafeInteger(blockHeight) ||
    /** @type {number} */ (blockHeight) < 0
  ) {
    return Promise.resolve(null);
  }

  let found = received.get(tx);

  if (!found) {
    found = readReceived(nodeUrl, { blockHeight, pool, tx }, driver);
    received.set(tx, found);
    // A read that failed is made again the next time.
    found.then(
      (amount) => amount === null && received.delete(tx),
      () => received.delete(tx)
    );
  }

  return found.catch(() => null);
}

/**
 * @param {string} nodeUrl
 * @param {{ blockHeight?: number | null, pool: string, tx: string }} stake
 * @param {() => Promise<SozuDriver>} driver
 * @returns {Promise<bigint | null>}
 */
async function readReceived(nodeUrl, { blockHeight, pool, tx }, driver) {
  const data = await archiveAt(nodeUrl).query(
    `query { contractEvents(height: ${blockHeight}) { json } }`
  );
  const events = data?.contractEvents?.json;
  const event = Array.isArray(events)
    ? events.find(
        (e) =>
          e?.topic === "deposit" &&
          e.reverted !== true &&
          norm(e.source) === pool &&
          norm(e.origin) === tx
      )
    : undefined;
  const bytes = norm(event?.data);

  if (!/^(?:[0-9a-f]{2})+$/.test(bytes)) {
    return null;
  }

  const deposit = /** @type {Record<string, unknown>} */ (
    (await driver()).decodeEvent?.(
      "deposit",
      Uint8Array.from(bytes.match(/../g) ?? [], (b) => parseInt(b, 16))
    ) ?? {}
  );
  const amount = lux(deposit.amount);
  const fee = lux(deposit.fee);
  const stake = lux(deposit.total_stake);
  const supply = lux(deposit.token_total_supply);

  return amount === null ||
    fee === null ||
    stake === null ||
    supply === null ||
    amount <= fee
    ? null
    : stDuskFor(amount - fee, { stake, supply });
}
