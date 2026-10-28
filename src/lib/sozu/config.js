/**
 * Sozu: liquid staking on Dusk, run by a third party. Its hub contract
 * names the others; the pool given here is the one to use only until the
 * hub has been read.
 */

import { get, writable } from "svelte/store";

/** Sozu's site, for its own rules. */
export const SOZU_URL = "https://sozu.fi/";

/** The pool's functions the wallet calls. */
export const SOZU_FN = Object.freeze(
  /** @type {const} */ ({
    STAKE: "sozu_stake",
    UNSTAKE: "sozu_unstake",
  })
);

/** @type {Readonly<Record<string, SozuContracts>>} */
const SOZU_CONTRACTS = Object.freeze({
  mainnet: Object.freeze({
    hub: "b32c917e76abc6fcf2edbee0fa70231d8e19c405b18421794a11badfc66d2f26",
    pool: "6fdfdc713a18fc6ca2ad20eb2b4a3305a935ef47d6a872d9a4df8bc9fd9d169e",
  }),
  testnet: Object.freeze({
    hub: "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e",
    pool: "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2",
  }),
});

/**
 * Sozu's contracts on a network, or null where it has none.
 *
 * @param {string} networkName
 * @returns {SozuContracts | null}
 */
export const sozuContractsFor = (networkName) =>
  Object.hasOwn(SOZU_CONTRACTS, networkName)
    ? SOZU_CONTRACTS[networkName]
    : null;

/** Sozu's pools, for the history to name their calls. */
export const SOZU_POOLS = new Set(
  Object.values(SOZU_CONTRACTS).map(({ pool }) => pool)
);

const POOLS_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-sozu-pools`;

/** @param {unknown} id */
const contractIdOf = (id) =>
  String(id ?? "")
    .toLowerCase()
    .replace(/^0x/, "");

/** @returns {Set<string>} */
function readPools() {
  try {
    const kept = JSON.parse(localStorage.getItem(POOLS_KEY) ?? "[]");

    return new Set(
      Array.isArray(kept)
        ? kept.map(contractIdOf).filter((id) => /^[0-9a-f]{64}$/.test(id))
        : []
    );
  } catch {
    return new Set();
  }
}

const found = writable(readPools());

/**
 * The pools Sozu's hub named besides those above, kept on this device so
 * the history names their calls from the start.
 */
export const sozuPools = { subscribe: found.subscribe };

/**
 * Notes a pool Sozu's hub named.
 *
 * @param {string} id
 */
export function noteSozuPool(id) {
  const pool = contractIdOf(id);

  if (
    !/^[0-9a-f]{64}$/.test(pool) ||
    SOZU_POOLS.has(pool) ||
    get(found).has(pool)
  ) {
    return;
  }

  const next = new Set([...get(found), pool]);

  found.set(next);

  try {
    localStorage.setItem(POOLS_KEY, JSON.stringify([...next]));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Whether a call is one of Sozu's pool functions, whichever contract it
 * calls.
 *
 * @param {{ fnName?: string }} call
 */
export const isSozuFunction = ({ fnName }) =>
  fnName === SOZU_FN.STAKE || fnName === SOZU_FN.UNSTAKE;

/**
 * Whether a transaction is a stake or an unstake with Sozu: a call of one
 * of its pools, known here or named by its hub.
 *
 * @param {{ contractId?: string | null, fnName?: string }} call
 */
export const isSozuCall = (call) => {
  const pool = contractIdOf(call.contractId);

  return isSozuFunction(call) && (SOZU_POOLS.has(pool) || get(found).has(pool));
};
