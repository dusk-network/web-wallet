/**
 * Reads of the DuskEVM bridge's contracts on Dusk, through Multicall for
 * Dusk: the reads one task starts go to the node as one query. The Portal
 * and the dispute game factory are read with their bundled data drivers; a
 * dispute game's hub and the anchor state registry, for which none is
 * bundled, raw. What a deployment doesn't change is read once a session:
 * each proven game's hub, each game type's hub, and each hub's clock limit.
 */

import { bytesToHex } from "viem";
import { dataDrivers } from "@dusk/w3sper";
import { createMulticallFetch } from "@hdauven/dusk-multicall";
import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";
import { nodeBaseUrl } from "$lib/url";

/**
 * @typedef {{ call: Record<string, (args?: unknown) => Promise<any>> }} ContractReads
 *   A contract's read-only calls, as w3sper's `contract.call` gives them.
 * @typedef {{
 *   dgf: ContractReads,
 *   hub: (contractId: string) => ContractReads,
 *   nodeUrl: string,
 *   portal: ContractReads,
 *   registry?: ContractReads | null,
 * }} BridgeReads
 *   `registry`, the anchor state registry, where it's known.
 * @typedef {{
 *   anchorStateRegistryContractId?: string,
 *   disputeGameFactoryContractId: string,
 *   disputeGameFactoryDataDriverUrl: string,
 *   optimismPortalContractId: string,
 *   optimismPortalDataDriverUrl: string,
 * }} BridgeReadsConfig
 */

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
function batchedFetch(nodeUrl) {
  const multicallId = get(nodeNetwork)?.contracts.multicall ?? null;
  const key = `${nodeUrl} ${multicallId}`;
  let batched = batchedFetches.get(key);

  if (!batched) {
    batched = createMulticallFetch({ multicallId, nodeUrl });
    batchedFetches.set(key, batched);
  }

  return batched;
}

/**
 * A read's arguments as JSON, as w3sper writes them: big integers as text.
 *
 * @param {unknown} value
 */
const driverJson = (value) =>
  value === undefined || value === null
    ? "null"
    : JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item
      );

/**
 * A u64 as a contract returns it: 8 bytes, little-endian.
 *
 * @param {Uint8Array} bytes
 */
function readU64Le(bytes) {
  if (bytes.length < 8) {
    throw new RangeError("Expected an 8-byte u64");
  }

  let value = 0n;

  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[index]);
  }

  return value;
}

/**
 * A dispute game hub's views, read raw: no data driver is bundled for it.
 * A game's 20-byte address goes in (nothing for `maxClockDuration`); a u64,
 * little-endian, or the game's status byte comes out.
 *
 * @type {BridgeDriver}
 */
export const GAME_HUB_DRIVER = Object.freeze({
  /**
   * @param {string} fnName
   * @param {Uint8Array} bytes
   */
  decodeOutputFn(fnName, bytes) {
    if (fnName !== "statusForGame") {
      return readU64Le(bytes);
    }

    if (!bytes.length) {
      throw new RangeError("Expected the game's status byte");
    }

    return bytes[0];
  },

  /**
   * @param {string} fnName
   * @param {string} json
   */
  encodeInputFn: (fnName, json) =>
    fnName === "maxClockDuration"
      ? new Uint8Array(0)
      : Uint8Array.from(JSON.parse(json)),
});

/**
 * The anchor state registry's views, read raw like the hubs: the Portal asks
 * it whether a game is proper (registered, not blacklisted, not retired) and
 * respected. A game's 20-byte address goes in, and yes or no comes out;
 * `respectedGameTypeUpdatedAt` takes nothing and gives a u64.
 *
 * @type {BridgeDriver}
 */
export const GAME_REGISTRY_DRIVER = Object.freeze({
  /**
   * @param {string} fnName
   * @param {Uint8Array} bytes
   */
  decodeOutputFn(fnName, bytes) {
    if (fnName === "respectedGameTypeUpdatedAt") {
      return readU64Le(bytes);
    }

    if (bytes.length !== 1 || bytes[0] > 1) {
      throw new RangeError(`Expected ${fnName}'s yes or no`);
    }

    return bytes[0] === 1;
  },

  /**
   * @param {string} fnName
   * @param {string} json
   */
  encodeInputFn: (fnName, json) =>
    fnName === "respectedGameTypeUpdatedAt"
      ? new Uint8Array(0)
      : Uint8Array.from(JSON.parse(json)),
});

/**
 * The bridge's contracts on Dusk, read through the node's Multicall for Dusk
 * batcher. Both drivers load before any read goes out, so the reads one task
 * starts go together.
 *
 * @param {{
 *   config: BridgeReadsConfig,
 *   fetch?: typeof fetch,
 *   loadDriver?: (url: string) => Promise<BridgeDriver>,
 *   nodeUrl?: string,
 * }} options
 * @returns {BridgeReads}
 */
export function bridgeReads({
  config,
  fetch: fetchFn,
  loadDriver = loadBridgeDriver,
  nodeUrl = nodeBaseUrl(),
}) {
  const send = fetchFn ?? batchedFetch(nodeUrl);
  const loaded = Promise.all([
    loadDriver(config.optimismPortalDataDriverUrl),
    loadDriver(config.disputeGameFactoryDataDriverUrl),
  ]);

  /**
   * @param {BridgeDriver} driver
   * @param {string} contractId
   * @param {string} fnName
   * @param {unknown} args
   */
  const read = async (driver, contractId, fnName, args) => {
    const res = await send(`${nodeUrl}/on/contracts:${contractId}/${fnName}`, {
      body: /** @type {BodyInit} */ (
        driver.encodeInputFn(fnName, driverJson(args))
      ),
      headers: { "Content-Type": "application/octet-stream" },
      method: "POST",
    });

    if (!res.ok) {
      // A refusal carries the contract's own words, as a check's does.
      const refusal = await res.text().catch(() => "");

      throw new Error(refusal || `The ${fnName} read failed: ${res.status}`);
    }

    return driver.decodeOutputFn(
      fnName,
      new Uint8Array(await res.arrayBuffer())
    );
  };

  /**
   * @param {(drivers: BridgeDriver[]) => BridgeDriver} pick
   * @param {string} contractId
   * @returns {ContractReads}
   */
  const contract = (pick, contractId) => ({
    call: /** @type {ContractReads["call"]} */ (
      new Proxy(
        {},
        {
          get:
            (_target, fnName) =>
            /** @param {unknown} [args] */
            async (args) =>
              read(pick(await loaded), contractId, String(fnName), args),
        }
      )
    ),
  });

  return {
    dgf: contract(([, dgf]) => dgf, config.disputeGameFactoryContractId),
    hub: (contractId) => contract(() => GAME_HUB_DRIVER, contractId),
    nodeUrl,
    portal: contract(([portal]) => portal, config.optimismPortalContractId),
    registry: config.anchorStateRegistryContractId
      ? contract(
          () => GAME_REGISTRY_DRIVER,
          config.anchorStateRegistryContractId
        )
      : null,
  };
}

/**
 * Settles a read: its value, or why it failed.
 *
 * @template T
 * @param {Promise<T>} promise
 * @returns {Promise<{ error?: Error, value?: T }>}
 */
export const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({
      error: error instanceof Error ? error : new Error(String(error)),
    })
  );

/**
 * A read kept once it succeeded; one that failed is read again next time.
 *
 * @template T
 * @param {Map<string, Promise<T>>} cache
 * @param {string} key
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
function once(cache, key, load) {
  let kept = cache.get(key);

  if (!kept) {
    kept = load();

    const pending = kept;

    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) {
        cache.delete(key);
      }
    });
  }

  return kept;
}

/**
 * A contract ID as a read gives it, 32 bytes or their hex, as lower-case hex.
 *
 * @param {unknown} value
 */
function contractIdHex(value) {
  const id =
    typeof value === "string"
      ? value.replace(/^0x/u, "").toLowerCase()
      : value instanceof Uint8Array || Array.isArray(value)
        ? bytesToHex(Uint8Array.from(value)).slice(2)
        : "";

  if (!/^[0-9a-f]{64}$/u.test(id)) {
    throw new RangeError("Expected a 32-byte contract ID");
  }

  return id;
}

/**
 * A 20-byte EVM address as the reads take it.
 *
 * @param {string} address
 */
const addressBytes = (address) =>
  Array.from(address.replace(/^0x/u, "").match(/../gu) ?? [], (byte) =>
    parseInt(byte, 16)
  );

/** @type {Map<string, Promise<string>>} Each proven game's hub, by node and game. */
const gameHubs = new Map();

/** @type {Map<string, string>} The same, once read. */
const knownGameHubs = new Map();

/** @type {Map<string, Promise<string>>} Each game type's hub, by node and type. */
const typeHubs = new Map();

/** @type {Map<string, Promise<bigint>>} Each hub's clock limit, by node and hub. */
const hubClocks = new Map();

/**
 * @param {BridgeReads} reads
 * @param {string} proxy
 */
const gameKey = (reads, proxy) => `${reads.nodeUrl}\n${proxy.toLowerCase()}`;

/**
 * The hub a proven game is on, as the Portal reads it: the factory names it.
 *
 * @param {BridgeReads} reads
 * @param {string} proxy The game's address
 * @returns {Promise<string>}
 */
export const hubOfGame = (reads, proxy) =>
  once(gameHubs, gameKey(reads, proxy), () =>
    reads.dgf.call.gameContractId(addressBytes(proxy)).then((bytes) => {
      const id = contractIdHex(bytes);

      knownGameHubs.set(gameKey(reads, proxy), id);

      return id;
    })
  );

/**
 * A proven game's hub, if it was read before: a check can then read the
 * game in the same query as the Portal.
 *
 * @param {BridgeReads} reads
 * @param {string} proxy
 * @returns {string | null}
 */
export const knownHubOf = (reads, proxy) =>
  knownGameHubs.get(gameKey(reads, proxy)) ?? null;

/**
 * The hub that holds a game type's games.
 *
 * @param {BridgeReads} reads
 * @param {number} gameType
 * @returns {Promise<string>}
 */
export const hubOfType = (reads, gameType) =>
  once(typeHubs, `${reads.nodeUrl}\n${gameType}`, () =>
    reads.dgf.call.virtualGameHubId(gameType).then(contractIdHex)
  );

/**
 * A hub's clock limit, `maxClockDuration`, in seconds.
 *
 * @param {BridgeReads} reads
 * @param {string} hubId
 * @returns {Promise<bigint>}
 */
export const hubClock = (reads, hubId) =>
  once(hubClocks, `${reads.nodeUrl}\n${hubId}`, () =>
    reads
      .hub(hubId)
      .call.maxClockDuration()
      .then((seconds) => BigInt(seconds))
  );

/**
 * A game as its hub gives it, with the hub's clock limit, started together
 * so that they go in one query.
 *
 * @param {BridgeReads} reads
 * @param {string} hubId
 * @param {string} proxy The game's address
 * @returns {Promise<{ createdAt: bigint, maxClockDuration: bigint, resolvedAt: bigint, status: number }>}
 */
export function readGame(reads, hubId, proxy) {
  const hub = reads.hub(hubId);
  const address = addressBytes(proxy);

  return Promise.all([
    hub.call.createdAtForGame(address),
    hub.call.resolvedAtForGame(address),
    hub.call.statusForGame(address),
    hubClock(reads, hubId),
  ]).then(([createdAt, resolvedAt, status, maxClockDuration]) => ({
    createdAt: BigInt(createdAt),
    maxClockDuration,
    resolvedAt: BigInt(resolvedAt),
    status: Number(status),
  }));
}
