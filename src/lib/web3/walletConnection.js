/**
 * The EVM wallets the Bridge and Migrate pages connect: Reown AppKit with
 * wagmi, started only when someone asks to connect a wallet there, or as
 * one of those pages opens when a wallet was connected before, to bring it
 * back. Until then nothing of it runs: no requests to Reown, WalletConnect
 * or Coinbase, no fonts loaded, and nothing kept in the browser. AppKit's
 * analytics are off, and so are the Coinbase and Base Account wallet SDKs,
 * which report to Coinbase on their own.
 */

import {
  disconnect,
  getAccount,
  http,
  reconnect,
  watchAccount,
} from "@wagmi/core";
import { writable } from "svelte/store";

import { duskEvm } from "./duskEvm";

export { duskEvm };

/**
 * @constant {string} projectId - The ID of the project, sourced from an environment variable.
 *
 * @description
 * This constant retrieves the project ID from the environment variable `VITE_REOWN_PROJECT_ID`.
 * If the environment variable is not set, it defaults to an empty string. This behavior is not ideal
 * because an empty `projectId` will cause the modal initialization to fail.
 *
 * When the `projectId` is missing, the "migrate" and "bridge" functionality isn't accessible in the UI.
 */
const VITE_REOWN_PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || "";

/**
 * The wagmi configuration, once the connection started.
 *
 * @type {import("@wagmi/core").Config}
 */
export let wagmiConfig;

/**
 * The connect dialog, once the connection started.
 *
 * @type {import("@reown/appkit").AppKit | undefined}
 */
let appKit;

/**
 * @typedef {Parameters<import("@reown/appkit").AppKit["subscribeEvents"]>[0]} ModalEventHandler
 */

/** What follows the dialog's events, from when the connection starts. */
/** @type {Set<ModalEventHandler>} */
const eventHandlers = new Set();

const failure = writable(false);

/** Whether the connection failed to load, the last time it was asked for. */
export const connectionFailed = { subscribe: failure.subscribe };

/**
 * The EVM wallets' dialog. Opening it starts the connection first, if it
 * isn't yet: a failure to load shows as `connectionFailed`.
 */
export const modal = {
  async open() {
    try {
      await startWalletConnection();
    } catch {
      return;
    }

    await appKit?.open();
  },

  /**
   * Follows the dialog's events, from when the connection starts.
   *
   * @param {ModalEventHandler} handler
   * @returns {() => void} What stops following them
   */
  subscribeEvents(handler) {
    eventHandlers.add(handler);

    return () => eventHandlers.delete(handler);
  },
};

const accountStore = writable(
  /** @type {import("@wagmi/core").GetAccountReturnType} */ (
    /** @type {unknown} */ ({
      address: undefined,
      addresses: undefined,
      chain: undefined,
      chainId: undefined,
      connector: undefined,
      isConnected: false,
      isConnecting: false,
      isDisconnected: true,
      isReconnecting: false,
      status: "disconnected",
    })
  )
);

/** The connected EVM account: none until the connection started. */
export const account = { subscribe: accountStore.subscribe };

/** @type {Promise<void> | null} */
let starting = null;

/**
 * The longest the pages wait for a wallet connected before to reconnect:
 * they then show the account as it is, and follow it as it changes.
 */
const RECONNECT_WAIT_MS = 5_000;

/**
 * Starts the connection, once, for the pages that need it.
 *
 * @returns {Promise<void>}
 */
export function startWalletConnection() {
  if (!starting) {
    failure.set(false);
    starting = start();
    starting.catch(() => {
      starting = null;
      failure.set(true);
    });
  }

  return starting;
}

/**
 * Whether an EVM wallet was connected here before, as wagmi keeps it, or
 * the connection started already: a page then starts it as it opens, to
 * bring the wallet back.
 *
 * @returns {boolean}
 */
export function wasConnectedBefore() {
  if (starting) {
    return true;
  }

  try {
    const { state } =
      JSON.parse(localStorage.getItem("wagmi.store") ?? "null") ?? {};

    return Boolean(state?.current || state?.connections?.value?.length);
  } catch {
    return false;
  }
}

async function start() {
  const [{ createAppKit }, { WagmiAdapter }, { bsc, mainnet, sepolia }] =
    await Promise.all([
      import("@reown/appkit"),
      import("@reown/appkit-adapter-wagmi"),
      import("@reown/appkit/networks"),
    ]);

  /** @type {[import("@reown/appkit/networks").AppKitNetwork, ...import("@reown/appkit/networks").AppKitNetwork[]]} */
  const networks = [sepolia, bsc, mainnet, duskEvm];
  const wagmiAdapter = new WagmiAdapter({
    networks,
    projectId: VITE_REOWN_PROJECT_ID,
    transports: {
      [duskEvm.id]: http(duskEvm.rpcUrls.default.http[0]),
    },
  });

  wagmiConfig = wagmiAdapter.wagmiConfig;
  appKit = createAppKit({
    adapters: [wagmiAdapter],
    defaultNetwork: duskEvm,
    // The Coinbase and Base Account SDKs send their own telemetry.
    enableBaseAccount: false,
    enableCoinbase: false,
    // Wallets only: no email or social logins, which would make a new wallet.
    features: {
      analytics: false,
      email: false,
      onramp: false,
      socials: false,
      swaps: false,
    },
    networks,
    projectId: VITE_REOWN_PROJECT_ID,
    themeMode: "dark",
  });

  appKit?.subscribeEvents((event) => {
    for (const handler of eventHandlers) {
      handler(event);
    }
  });
  accountStore.set(getAccount(wagmiConfig));
  watchAccount(wagmiConfig, { onChange: (next) => accountStore.set(next) });
  window.addEventListener("beforeunload", walletDisconnect);

  // A wallet connected before comes back before the pages use it.
  await Promise.race([
    reconnect(wagmiConfig).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, RECONNECT_WAIT_MS)),
  ]);
}

export async function walletDisconnect() {
  if (!wagmiConfig) {
    return;
  }

  await disconnect(wagmiConfig);
  await appKit?.disconnect();
}
