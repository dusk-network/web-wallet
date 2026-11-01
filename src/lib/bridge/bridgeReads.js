/**
 * What the DuskEVM bridge's reads on Dusk go through: the Portal's and the
 * dispute game factory's bundled data drivers, loaded once, the node's
 * Multicall for Dusk batcher, which sends the reads one task starts as one
 * query, and what the reads find that can't change any more.
 */

import { dataDrivers } from "@dusk/w3sper";
import { createMulticallFetch } from "@hdauven/dusk-multicall";
import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";

/**
 * What the bridge's reads find that can't change any more, kept for the
 * session: each game's hub, each game type's hub, each hub's clock, and,
 * once their blocks are final, a withdrawal's receipt and the calls of the
 * deposits a sender's history lists. Each key names the chain or the
 * contract its fact is of: one map serves every network.
 *
 * @type {Map<string, string>}
 */
export const bridgeFacts = new Map();

/** @type {Map<string, Promise<BridgeDriver>>} */
const drivers = new Map();

/**
 * A bridge contract's data driver, fetched and started once; one that failed
 * to load is loaded again by the next read.
 *
 * @param {string} url
 * @returns {Promise<BridgeDriver>}
 */
export function loadBridgeDriver(url) {
  let driver = drivers.get(url);

  if (!driver) {
    driver = fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Couldn't load the data driver at ${url}`);
        }

        return res.arrayBuffer();
      })
      .then((bytes) => dataDrivers.load(new Uint8Array(bytes)))
      .then((loaded) => {
        loaded.init();

        return loaded;
      });

    const kept = driver;

    drivers.set(url, kept);
    kept.catch(() => {
      if (drivers.get(url) === kept) {
        drivers.delete(url);
      }
    });
  }

  return driver;
}

/** @type {Map<string, typeof fetch>} */
const batchedFetches = new Map();

/**
 * The node's batched fetch: the reads of one task go to it as one Multicall
 * for Dusk query, on a network that has the multicall.
 *
 * @param {string} nodeUrl
 */
export function batchedFetch(nodeUrl) {
  const multicallId = get(nodeNetwork)?.contracts.multicall ?? null;
  const key = `${nodeUrl} ${multicallId}`;
  let batched = batchedFetches.get(key);

  if (!batched) {
    batched = createMulticallFetch({ multicallId, nodeUrl });
    batchedFetches.set(key, batched);
  }

  return batched;
}
