/**
 * DuskEVM on the node's network, from its file in `@dusk-network/networks`:
 * the chain as EVM wallets and viem see it, and its contracts on Dusk. Each
 * value can be set for local work through env. It's read as it's used, so
 * it follows the network the node gives; where that has no DuskEVM, its
 * values are undefined and `duskEvmNetwork()` is null.
 */

import { get } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";

/** @param {unknown} value */
const setting = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** DuskEVM on the node's network, as its file has it, or null. */
export const duskEvmNetwork = () => get(nodeNetwork)?.duskEvm ?? null;

/**
 * A DuskEVM contract on Dusk, by its name in duskevm-genesis
 * ("optimism_portal"), as a contract ID without 0x: the one set in `env`,
 * else the network's; "" where there's neither.
 *
 * @param {string} name
 * @param {unknown} [env] The variable that sets it
 */
export function duskEvmContractId(name, env) {
  const set = setting(env)?.toLowerCase().replace(/^0x/, "");

  return set ?? duskEvmNetwork()?.contracts[name]?.contractId ?? "";
}

/**
 * A data driver DuskEVM's network file names, served with the wallet, or
 * the URL set in `env`.
 *
 * @param {"disputeGameFactory" | "optimismPortal"} name
 * @param {unknown} [env]
 */
export function duskEvmDriverUrl(name, env) {
  const file = duskEvmNetwork()?.drivers[name]?.file;

  return setting(env) ?? (file ? `/drivers/${file}` : "");
}

/** @returns {string | undefined} */
const rpcUrl = () =>
  setting(import.meta.env.VITE_EVM_BRIDGE_RPC_URL) ?? duskEvmNetwork()?.rpcUrl;

/** @param {string | undefined} rpc */
const adapterBeside = (rpc) =>
  rpc ? `${rpc.replace(/\/+$/, "")}/l1` : undefined;

/**
 * DuskEVM's adapter, which says what a Dusk deposit became on DuskEVM
 * (`duskevm_getTransactionHashByDuskHash`): as set; else at `/l1` on the
 * RPC set for local work; else the network's, as its file gives it, or at
 * `/l1` on its RPC.
 *
 * @returns {string | undefined}
 */
export function duskEvmAdapterUrl() {
  const set = setting(import.meta.env.VITE_EVM_L1_BRIDGE_RPC_URL);
  const local = setting(import.meta.env.VITE_EVM_BRIDGE_RPC_URL);

  return (
    set ??
    adapterBeside(local) ??
    duskEvmNetwork()?.l1AdapterUrl ??
    adapterBeside(rpcUrl())
  );
}

/**
 * DuskEVM's Blockscout API: the network's, as its file gives it, else beside
 * the explorer set for local work.
 *
 * @returns {string | undefined}
 */
export function duskEvmBlockscoutApiUrl() {
  const explorer = setting(import.meta.env.VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL);

  return explorer
    ? `${explorer.replace(/\/+$/, "")}/api/v2`
    : duskEvmNetwork()?.blockscoutApiUrl;
}

/**
 * A DuskEVM transaction in DuskEVM's explorer: null where there's none.
 *
 * @param {string} hash
 * @returns {string | null}
 */
export function duskEvmExplorerTx(hash) {
  const url = duskEvm.blockExplorers.default.url;

  return url ? `${String(url).replace(/\/+$/, "")}/tx/${hash}` : null;
}

/**
 * DuskEVM as a viem chain. Read on use: the node's network gives it.
 */
export const duskEvm = {
  get blockExplorers() {
    return {
      default: {
        name:
          setting(import.meta.env.VITE_EVM_BRIDGE_BLOCK_EXPLORER_NAME) ??
          "DuskEVM explorer",
        url:
          setting(import.meta.env.VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL) ??
          duskEvmNetwork()?.explorerUrl,
      },
    };
  },

  get contracts() {
    return {
      L2StandardBridge: {
        address:
          setting(import.meta.env.VITE_EVM_BRIDGE_CONTRACT_ADDRESS) ??
          duskEvmNetwork()?.predeploys.l2StandardBridge,
        blockCreated: import.meta.env.VITE_EVM_BRIDGE_CONTRACT_BLOCK_CREATED,
      },
    };
  },

  get id() {
    return (
      Number(setting(import.meta.env.VITE_EVM_CHAIN_ID)) ||
      /** @type {number} */ (duskEvmNetwork()?.chainId)
    );
  },

  get name() {
    return duskEvmNetwork()?.name ?? "DuskEVM";
  },

  get nativeCurrency() {
    return (
      duskEvmNetwork()?.currency ?? {
        decimals: 18,
        name: "DUSK",
        symbol: "DUSK",
      }
    );
  },

  get rpcUrls() {
    const http = [/** @type {string} */ (rpcUrl())];

    return { default: { http }, public: { http } };
  },
};
