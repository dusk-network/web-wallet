/**
 * What an account has with Sozu, as `@dusk-network/networks/sozu` reads it:
 * the contracts the hub names, the pool's rate, the account's balances
 * there, and Sozu's fees and switches. Its reads go through this wallet's
 * Multicall for Dusk batcher, so a refresh is one query.
 */

import { dataDrivers } from "@dusk/w3sper";
import { readSozuStatus as readStatus } from "@dusk-network/networks/sozu";

import { createMulticallFetch } from "$lib/activity/multicallFetch";
import { addBasePath } from "$lib/navigation";

import { noteSozuPool } from "./config";

/** @typedef {"sozu_pool"} SozuDriverName */

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
 * A contract read as the package asks for it: the reply's bytes.
 *
 * @param {{ fetch: typeof fetch, nodeUrl: string, signal?: AbortSignal }} reader
 * @returns {import("@dusk-network/networks/sozu").SozuRead}
 */
const contractRead = (reader) => async (contractId, fnName, args) => {
  const res = await reader.fetch(
    `${reader.nodeUrl}/on/contracts:${contractId}/${fnName}`,
    {
      body: /** @type {BodyInit} */ (args),
      headers: { "Content-Type": "application/octet-stream" },
      method: "POST",
      signal: reader.signal,
    }
  );

  if (!res.ok) {
    throw new Error(`Sozu's ${fnName} read failed: ${res.status}`);
  }

  return new Uint8Array(await res.arrayBuffer());
};

/**
 * Reads what `account` has with Sozu. It fails when the pool's rate or the
 * account's balances there can't be read, as the figures the wallet shows
 * need them; fees and switches that can't be read are null.
 *
 * @param {{
 *   account: string,
 *   contracts: import("@dusk-network/networks/sozu").SozuStart,
 *   fetch?: typeof fetch,
 *   loadDriver?: (name: SozuDriverName) => Promise<SozuDriver>,
 *   nodeUrl: string,
 *   signal?: AbortSignal,
 * }} options `contracts`: the network's `sozu`, its hub and fallbacks
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
  // `balance_of` takes the account as the pool's data driver encodes it.
  const pool = await loadDriver("sozu_pool");
  const status = await readStatus({
    account: pool.encodeInputFn("balance_of", JSON.stringify(account)),
    contracts,
    read: contractRead({
      fetch: fetchFn ?? batchedFetch(nodeUrl),
      nodeUrl,
      signal,
    }),
  });
  const { balance = null, stDusk = null } = status.position ?? {};
  const { pool: poolId } = status.contracts;

  if (!poolId || !status.pool || balance === null || stDusk === null) {
    throw new Error(status.error || "Sozu couldn't be read");
  }

  // The history names this pool's calls too, from now on.
  noteSozuPool(poolId);

  return {
    ...status,
    contracts: { ...status.contracts, pool: poolId },
    pool: status.pool,
    position: { balance, stDusk },
  };
}
