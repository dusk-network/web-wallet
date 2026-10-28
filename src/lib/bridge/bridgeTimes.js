/**
 * The network and what its chains said about the bridge's times, for the
 * Bridge and Migrate cards: `load` reads the chains again where it's been a
 * while, and the store follows.
 */

import { get, writable } from "svelte/store";

import { networkStore } from "$lib/stores";
import { duskEvm, duskEvmNetwork } from "$lib/web3/duskEvm";

import { createChainTimes, readDepositLag } from "./chainTimes";
import {
  getWithdrawalFinalizationConfig,
  loadWithdrawalTiming,
} from "./withdrawals";

/** @type {import("svelte/store").Writable<{ chain: ChainTimes | null, network: string }>} */
const store = writable({ chain: null, network: "" });

/** @type {{ key: string, times: ReturnType<typeof createChainTimes> } | null} */
let current = null;

/**
 * Several DuskEVM requests in one, answered in order.
 *
 * @param {{ method: string, params: unknown[] }[]} calls
 */
async function l2Batch(calls) {
  const res = await fetch(duskEvm.rpcUrls.default.http[0], {
    body: JSON.stringify(
      calls.map((call, id) => ({ id, jsonrpc: "2.0", ...call }))
    ),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`DuskEVM answered ${res.status}`);
  }

  const body = await res.json();
  const byId = new Map(
    (Array.isArray(body) ? body : [body]).map((item) => [item?.id, item])
  );

  return calls.map((_, id) => byId.get(id)?.result);
}

/** @param {bigint} height */
const blockTime = (height) =>
  networkStore
    .connect()
    .then((network) =>
      network.query(`block(height: ${height}) { header { timestamp } }`)
    )
    .then((data) => data?.block?.header?.timestamp);

/**
 * The withdrawal contracts this network's bridge uses, or null where it has
 * none configured.
 */
function finalizationConfig() {
  try {
    const config = getWithdrawalFinalizationConfig();

    return config.configured ? config : null;
  } catch {
    return null;
  }
}

/** Reads the chains again where it's been a while; the store follows. */
function load() {
  const network = get(networkStore).networkName;
  const config = finalizationConfig();

  if (!config) {
    current = null;
    store.set({ chain: null, network });

    return Promise.resolve();
  }

  const key = `${CONFIG.LOCAL_STORAGE_APP_KEY}-bridge-times-${network}-${config.optimismPortalContractId}`;

  if (current?.key !== key) {
    current = {
      key,
      times: createChainTimes({
        key,
        read: {
          deposit: () =>
            readDepositLag({
              blockTime,
              l1Block: String(duskEvmNetwork()?.predeploys.l1Block ?? ""),
              l2Batch,
            }),
          withdrawal: () => loadWithdrawalTiming(),
        },
      }),
    };
  }

  const { times } = current;

  store.set({ chain: times.get(), network });

  return times.refresh().then(
    (moved) => {
      if (moved && current?.times === times) {
        store.set({ chain: times.get(), network });
      }
    },
    () => {}
  );
}

export default { load, subscribe: store.subscribe };
