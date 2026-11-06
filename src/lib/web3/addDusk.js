/**
 * DUSK added to an EVM wallet, through the wallet's own request for it
 * (EIP-747's wallet_watchAsset): DUSK of a route's chain, as the network's
 * file gives its token, for the wallet to show it. Asked only of a connected
 * wallet that takes the request, and kept, for each address and chain it was
 * added for, in this browser, so it's not offered again.
 */

import { getAccount, switchChain, watchAsset } from "@wagmi/core";
import { writable } from "svelte/store";

import { wagmiConfig } from "./walletConnection";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-evm-dusk-added`;

/** The token's decimals on every chain: its wei are lux times 10⁹. */
const DECIMALS = 18;

/** @returns {string[]} */
function read() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "[]");

    return Array.isArray(kept) ? kept.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

const added = writable(read());

/** Where DUSK was added: each address and chain, as `addedKey` writes it. */
export const duskAdded = { subscribe: added.subscribe };

/**
 * @param {number} chainId
 * @param {string} address
 */
export const addedKey = (chainId, address) =>
  `${chainId}:${address.toLowerCase()}`;

/** Forgets where DUSK was added, as Reset does. */
export function forgetDuskAdded() {
  added.set([]);

  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing is kept where storage can't be read.
  }
}

/** The wallets connected here that answered they don't take it, by connector. */
const unable = new Set();

/**
 * The code of an error from a wallet, wherever viem or wagmi put it.
 *
 * @param {unknown} error
 * @returns {number | undefined}
 */
function codeOf(error) {
  for (let at = /** @type {any} */ (error); at; at = at.cause) {
    if (typeof at.code === "number") {
      return at.code;
    }
  }

  return undefined;
}

/**
 * Whether a connected wallet takes the request: an injected one, whose own it
 * is; one over WalletConnect only where its session lists it. Not one that
 * answered it doesn't.
 *
 * @param {import("@wagmi/core").Connector | undefined} connector
 * @returns {Promise<boolean>}
 */
export async function takesAddDusk(connector) {
  if (!connector || unable.has(connector.uid)) {
    return false;
  }

  if (connector.type === "injected") {
    return true;
  }

  if (connector.type !== "walletConnect") {
    return false;
  }

  const provider = /** @type {any} */ (
    await connector.getProvider().catch(() => null)
  );
  const methods = provider?.session?.namespaces?.eip155?.methods;

  return Array.isArray(methods) && methods.includes("wallet_watchAsset");
}

/**
 * Asks the connected wallet to add DUSK of `chain`, on that chain: true once
 * it did. A refusal is no error and says nothing; a wallet that answers it
 * doesn't take the request isn't asked again.
 *
 * @param {{ chainId: number, token?: string, tokenLabel?: string }} chain
 * @returns {Promise<boolean>}
 */
export async function addDusk(chain) {
  const { address, chainId, connector } = getAccount(wagmiConfig);

  if (!address || !chain.token) {
    return false;
  }

  try {
    // A wallet adds a token to the chain it's on.
    if (chainId !== chain.chainId) {
      await switchChain(wagmiConfig, { chainId: chain.chainId });
    }

    const isAdded = await watchAsset(wagmiConfig, {
      options: {
        address: chain.token,
        decimals: DECIMALS,
        // "BEP20 DUSK" is DUSK to the wallet.
        symbol: chain.tokenLabel?.split(" ").at(-1) ?? "DUSK",
      },
      type: "ERC20",
    });

    if (isAdded) {
      const key = addedKey(chain.chainId, address);

      added.update((keys) => (keys.includes(key) ? keys : [...keys, key]));

      try {
        localStorage.setItem(KEY, JSON.stringify(read().concat(key)));
      } catch {
        // Offered again where storage can't be written.
      }
    }

    return isAdded;
  } catch (error) {
    const code = codeOf(error);

    // 4200: not a method it has; -32601: not found.
    if (connector && (code === 4200 || code === -32601)) {
      unable.add(connector.uid);
    }

    return false;
  }
}
