/**
 * What an account has with Sozu: the pool and the stDUSK token the hub
 * names, the pool's rate, and the account's balances there. The reads go
 * through Multicall for Dusk, a query for all those made at once.
 */

import { dataDrivers } from "@dusk/w3sper";
import { createMulticallFetch } from "$lib/activity/multicallFetch";
import { addBasePath } from "$lib/navigation";

import { parsePool, readLux } from "./amounts";

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

/** @type {Map<string, Promise<{ pool: string | null, stDusk: string | null }>>} */
const found = new Map();

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
    ]).then(([pool, stDusk]) => ({
      pool: contractIdOf(pool),
      stDusk: contractIdOf(stDusk),
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
  const [rate, balance, stDusk] = await Promise.all([
    read(reader, pool, poolId, "exchange_rate"),
    read(reader, pool, poolId, "balance_of", account),
    named.stDusk
      ? read(reader, token, named.stDusk, "balance_of", account)
      : "0",
  ]);

  return {
    contracts: { hub: contracts.hub, pool: poolId, stDusk: named.stDusk },
    pool: parsePool(rate),
    position: { balance: readLux(balance), stDusk: readLux(stDusk) },
  };
}
