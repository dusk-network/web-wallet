/**
 * Sozu: liquid staking on Dusk, run by a third party. Its hub contract
 * names the others; each network's file gives the hub, and the pool to use
 * only until the hub has been read.
 */

import { networks } from "@dusk-network/networks";
import { SOZU_FN } from "@dusk-network/networks/sozu";
import { get, writable } from "svelte/store";

export { SOZU_FN };

/** Sozu's site. */
export const SOZU_URL = "https://sozu.fi/";

/**
 * Sozu's hub on a network and the contracts it named when the network's
 * file was written, or null where it has none.
 *
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 * @returns {SozuContracts | null}
 */
export const sozuContractsFor = (net) => net?.sozu ?? null;

/** Sozu's pools, for the history to name their calls. */
export const SOZU_POOLS = new Set(
  Object.values(networks).flatMap((net) =>
    net.sozu ? [net.sozu.fallbacks.pool] : []
  )
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
 * of its pools, known here or named by its hub. A view passes the pools it
 * subscribed to (sozuPools), so that it reads its rows again when the hub
 * names another one.
 *
 * @param {{ contractId?: string | null, fnName?: string }} call
 * @param {Set<string>} [pools] The pools the hub named
 */
export const isSozuCall = (call, pools = get(found)) => {
  const pool = contractIdOf(call.contractId);

  return isSozuFunction(call) && (SOZU_POOLS.has(pool) || pools.has(pool));
};
