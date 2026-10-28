/**
 * What an account has with Sozu: the pool and the stDUSK token the hub
 * names, the pool's rate, Sozu's fees and switches, and the account's
 * balances there. The reads go through Multicall for Dusk, a query for all
 * those made at once. The hub can name other contracts at any time, so each
 * refresh asks it again, in the same query as the figures. Those are read
 * from the contracts it named last (at first, the ones known before), and
 * read again from the new ones only when it names others.
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

/**
 * The contracts Sozu's figures are read from: the pool, the stDUSK token and
 * the substrate, as the hub names them.
 *
 * @typedef {{ pool: string, stDusk: string | null, substrate: string | null }} SozuNamed
 */

/** @type {Map<string, SozuNamed>} What each hub named last, by node and hub. */
const namedLast = new Map();

/** Switches not read, or that couldn't be. */
const UNKNOWN_FLAGS = Object.freeze({
  maintenance: null,
  synchronization: null,
});

/**
 * Sozu's fees and switches, read live with the pool's figures: one query
 * with them. Fees that can't be read are none, and each switch is on its
 * own: one that couldn't be read is null, not off.
 *
 * @param {SozuReader} reader
 * @param {string} substrate
 * @returns {Promise<{ fees: SozuFees | null, flags: SozuFlags }>}
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
  /** @param {"maintenance" | "synchronization"} kind */
  const flag = (kind) =>
    read(reader, SUBSTRATE, substrate, "is_feature_enabled", kind).then(
      (on) => on === true,
      () => null
    );

  return Promise.all([fees, flag("maintenance"), flag("synchronization")]).then(
    ([rates, maintenance, synchronization]) => ({
      fees: rates,
      flags: { maintenance, synchronization },
    })
  );
}

/**
 * The pool, the stDUSK token and the substrate the hub names now.
 *
 * @param {SozuReader} reader
 * @param {SozuDriver} hub
 * @param {string} hubId
 */
const askHub = (reader, hub, hubId) =>
  Promise.all([
    read(reader, hub, hubId, "contract", "pool"),
    read(reader, hub, hubId, "contract", "staked-dusk"),
    read(reader, hub, hubId, "contract", "substrate"),
  ]).then(([pool, stDusk, substrate]) => ({
    pool: contractIdOf(pool),
    stDusk: contractIdOf(stDusk),
    substrate: contractIdOf(substrate),
  }));

/**
 * The figures, from the contracts `ids` names: the pool's rate and the
 * account's balances there, and Sozu's fees and switches. A failure is
 * thrown where they're awaited, and isn't one when they aren't, as when the
 * hub names others meanwhile.
 *
 * @param {SozuReader} reader
 * @param {{ pool: SozuDriver, token: SozuDriver }} figureDrivers
 * @param {SozuNamed} ids
 * @param {string} account
 */
function readFigures(reader, { pool, token }, ids, account) {
  const figures = Promise.all([
    read(reader, pool, ids.pool, "exchange_rate"),
    read(reader, pool, ids.pool, "balance_of", account),
    ids.stDusk ? read(reader, token, ids.stDusk, "balance_of", account) : "0",
    ids.substrate
      ? substrateOf(reader, ids.substrate)
      : { fees: null, flags: UNKNOWN_FLAGS },
  ]);

  figures.catch(() => {});

  return figures;
}

/**
 * What the hub names now, kept as what it named last: a name it doesn't
 * have keeps the contract known before.
 *
 * @param {string} key The node and the hub
 * @param {{ pool: string | null, stDusk: string | null, substrate: string | null }} named
 * @param {SozuNamed} known
 * @returns {SozuNamed}
 */
function keepNamed(key, named, known) {
  const now = {
    pool: named.pool ?? known.pool,
    stDusk: named.stDusk ?? known.stDusk,
    substrate: named.substrate ?? known.substrate,
  };

  namedLast.set(key, now);

  return now;
}

/**
 * @param {SozuNamed} a
 * @param {SozuNamed} b
 */
const sameContracts = (a, b) =>
  a.pool === b.pool && a.stDusk === b.stDusk && a.substrate === b.substrate;

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
  const key = `${nodeUrl}\n${contracts.hub}`;
  /** @type {SozuNamed} */
  const known = {
    pool: contracts.pool,
    stDusk: contracts.stDusk ?? null,
    substrate: contracts.substrate ?? null,
  };
  // One query: the hub's names with the figures, these from what it named
  // last.
  const asked = askHub(reader, hub, contracts.hub);
  let ids = namedLast.get(key) ?? known;
  let figures = readFigures(reader, { pool, token }, ids, account);
  const named = await asked.catch(() => null);
  const now = named ? keepNamed(key, named, known) : ids;

  // Read again only from others the hub names now.
  if (!sameContracts(now, ids)) {
    ids = now;
    figures = readFigures(reader, { pool, token }, ids, account);
  }

  // The history names this pool's calls too, from now on.
  noteSozuPool(ids.pool);
  const [rate, balance, stDusk, substrate] = await figures;

  return {
    contracts: { hub: contracts.hub, pool: ids.pool, stDusk: ids.stDusk },
    fees: substrate.fees,
    flags: substrate.flags,
    pool: parsePool(rate),
    position: { balance: readLux(balance), stDusk: readLux(stDusk) },
  };
}
