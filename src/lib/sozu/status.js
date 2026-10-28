/**
 * What an account has with Sozu: the pool and the stDUSK token the hub
 * names, the pool's rate, Sozu's fees and switches, and the account's
 * balances there. The reads go through Multicall for Dusk, a query for all
 * those made at once: the hub's names once a session and node, then one query
 * a refresh, with the fees and switches read live.
 */

import { dataDrivers } from "@dusk/w3sper";
import { createMulticallFetch } from "$lib/activity/multicallFetch";
import { addBasePath } from "$lib/navigation";

import { parseFeeRate, parsePool, readLux } from "./amounts";
import { noteSozuPool } from "./config";

/** @typedef {"sozu_hub" | "sozu_pool" | "sozu_staked_dusk"} SozuDriverName */

/** @type {Map<string, Promise<SozuDriver>>} */
const drivers = new Map();

/**
 * A Sozu data driver, fetched and started once; one that failed to load is
 * loaded again by the next read.
 *
 * @param {SozuDriverName} name
 * @returns {Promise<SozuDriver>}
 */
export function loadSozuDriver(name) {
  let driver = drivers.get(name);

  if (!driver) {
    driver = fetch(addBasePath(`/drivers/${name}_data_driver.wasm`))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Couldn't load the ${name} data driver`);
        }

        return res.arrayBuffer();
      })
      .then((bytes) => dataDrivers.load(new Uint8Array(bytes)))
      .then((loaded) => {
        loaded.init();

        return loaded;
      });

    const kept = driver;

    drivers.set(name, kept);
    kept.catch(() => {
      if (drivers.get(name) === kept) {
        drivers.delete(name);
      }
    });
  }

  return driver;
}

/** @type {Map<string, typeof fetch>} */
const batchedFetches = new Map();

/**
 * The node's batched fetch, one per node, so the batcher keeps what it
 * learnt about the node.
 *
 * @param {string} nodeUrl
 */
function batchedFetch(nodeUrl) {
  let batched = batchedFetches.get(nodeUrl);

  if (!batched) {
    batched = createMulticallFetch({ nodeUrl });
    batchedFetches.set(nodeUrl, batched);
  }

  return batched;
}

/**
 * @typedef {{
 *   fetch: typeof fetch,
 *   nodeUrl: string,
 *   signal?: AbortSignal,
 * }} SozuReader
 */

/**
 * A read of a contract: the driver encodes the arguments and decodes the
 * reply.
 *
 * @param {SozuReader} reader
 * @param {SozuDriver} driver
 * @param {string} contractId
 * @param {string} fnName
 * @param {unknown} [args]
 * @returns {Promise<unknown>}
 */
async function read(reader, driver, contractId, fnName, args) {
  const body = driver.encodeInputFn(
    fnName,
    args === undefined ? "null" : JSON.stringify(args)
  );
  const res = await reader.fetch(
    `${reader.nodeUrl}/on/contracts:${contractId}/${fnName}`,
    {
      body: /** @type {BodyInit} */ (body),
      headers: { "Content-Type": "application/octet-stream" },
      method: "POST",
      signal: reader.signal,
    }
  );

  if (!res.ok) {
    throw new Error(`Sozu's ${fnName} read failed: ${res.status}`);
  }

  return driver.decodeOutputFn(fnName, new Uint8Array(await res.arrayBuffer()));
}

/** @param {unknown} id */
const contractIdOf = (id) =>
  typeof id === "string" && /^[0-9a-f]{64}$/i.test(id)
    ? id.toLowerCase()
    : null;

/** The substrate's kinds of fee and of switch: each an enum, one byte. */
const SUBSTRATE_KINDS = Object.freeze({
  deposit: 0,
  maintenance: 0,
  reward: 1,
  synchronization: 1,
});

/**
 * Sozu's substrate, read by hand: the wallet bundles no driver for it, and
 * the reads it makes of it need none. `stake_fee_rate` takes the fee's kind
 * (Deposit 0, Reward 1) and gives its rate; `is_feature_enabled` takes the
 * switch's (Maintenance 0, Synchronization 1) and gives whether it's on.
 *
 * @type {SozuDriver}
 */
const SUBSTRATE = Object.freeze({
  decodeOutputFn: (fnName, bytes) =>
    fnName === "is_feature_enabled" ? bytes[0] === 1 : parseFeeRate(bytes),
  encodeInputFn: (_fnName, json) =>
    Uint8Array.of(
      SUBSTRATE_KINDS[
        /** @type {keyof typeof SUBSTRATE_KINDS} */ (JSON.parse(json))
      ] ?? 0
    ),
});

/** @type {Map<string, Promise<{ pool: string | null, stDusk: string | null, substrate: string | null }>>} */
const found = new Map();

/**
 * Sozu's fees and switches, read live with the pool's figures: one query
 * with them. Ones that can't be read are none.
 *
 * @param {SozuReader} reader
 * @param {string} substrate
 * @returns {Promise<{ fees: SozuFees | null, flags: SozuFlags | null }>}
 */
function substrateOf(reader, substrate) {
  const fees = Promise.all([
    read(reader, SUBSTRATE, substrate, "stake_fee_rate", "deposit"),
    read(reader, SUBSTRATE, substrate, "stake_fee_rate", "reward"),
  ]).then(
    ([deposit, reward]) => ({
      deposit: /** @type {SozuFeeRate} */ (deposit),
      reward: /** @type {SozuFeeRate} */ (reward),
    }),
    () => null
  );
  const flags = Promise.all([
    read(reader, SUBSTRATE, substrate, "is_feature_enabled", "maintenance"),
    read(reader, SUBSTRATE, substrate, "is_feature_enabled", "synchronization"),
  ]).then(
    ([maintenance, synchronization]) => ({
      maintenance: maintenance === true,
      synchronization: synchronization === true,
    }),
    () => null
  );

  return Promise.all([fees, flags]).then(([rates, switches]) => ({
    fees: rates,
    flags: switches,
  }));
}

/**
 * The pool and the stDUSK token the hub names, read once a node and hub.
 *
 * @param {SozuReader} reader
 * @param {SozuDriver} hub
 * @param {string} hubId
 */
function discover(reader, hub, hubId) {
  const key = `${reader.nodeUrl}\n${hubId}`;
  let named = found.get(key);

  if (!named) {
    named = Promise.all([
      read(reader, hub, hubId, "contract", "pool"),
      read(reader, hub, hubId, "contract", "staked-dusk"),
      read(reader, hub, hubId, "contract", "substrate"),
    ]).then(([pool, stDusk, substrate]) => ({
      pool: contractIdOf(pool),
      stDusk: contractIdOf(stDusk),
      substrate: contractIdOf(substrate),
    }));

    const kept = named;

    found.set(key, kept);
    kept.catch(() => {
      if (found.get(key) === kept) {
        found.delete(key);
      }
    });
  }

  return named;
}

/**
 * Reads what `account` has with Sozu.
 *
 * @param {{
 *   account: string,
 *   contracts: SozuContracts,
 *   fetch?: typeof fetch,
 *   loadDriver?: (name: SozuDriverName) => Promise<SozuDriver>,
 *   nodeUrl: string,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<SozuStatus>}
 */
export async function readSozuStatus({
  account,
  contracts,
  fetch: fetchFn,
  loadDriver = loadSozuDriver,
  nodeUrl,
  signal,
}) {
  /** @type {SozuReader} */
  const reader = { fetch: fetchFn ?? batchedFetch(nodeUrl), nodeUrl, signal };
  const [hub, pool, token] = await Promise.all([
    loadDriver("sozu_hub"),
    loadDriver("sozu_pool"),
    loadDriver("sozu_staked_dusk"),
  ]);
  const named = await discover(reader, hub, contracts.hub);
  const poolId = named.pool ?? contracts.pool;

  // The history names this pool's calls too, from now on.
  noteSozuPool(poolId);
  const [rate, balance, stDusk, substrate] = await Promise.all([
    read(reader, pool, poolId, "exchange_rate"),
    read(reader, pool, poolId, "balance_of", account),
    named.stDusk
      ? read(reader, token, named.stDusk, "balance_of", account)
      : "0",
    named.substrate
      ? substrateOf(reader, named.substrate)
      : { fees: null, flags: null },
  ]);

  return {
    contracts: { hub: contracts.hub, pool: poolId, stDusk: named.stDusk },
    fees: substrate.fees,
    flags: substrate.flags,
    pool: parsePool(rate),
    position: { balance: readLux(balance), stDusk: readLux(stDusk) },
  };
}
