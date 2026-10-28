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
import { routes } from "@dusk-network/networks";
import { get, writable } from "svelte/store";

import nodeNetwork from "$lib/stores/nodeNetwork";

import { duskEvm } from "./duskEvm";

export { duskEvm };

/**
 * An EVM chain as AppKit and viem take it, from what a network's file says
 * of it.
 *
 * @param {{ chainId: number, currency: { decimals: number, name: string, symbol: string }, explorerUrl: string, name: string, rpcUrl: string }} chain
 * @returns {import("@reown/appkit/networks").AppKitNetwork}
 */
const appKitChain = (chain) =>
  /** @type {import("@reown/appkit/networks").AppKitNetwork} */ ({
    blockExplorers: {
      default: { name: `${chain.name} explorer`, url: chain.explorerUrl },
    },
    caipNetworkId: `eip155:${chain.chainId}`,
    chainNamespace: "eip155",
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: chain.currency,
    rpcUrls: { default: { http: [chain.rpcUrl] } },
  });

/**
 * The EVM chains the node's network's routes reach, each once: DuskEVM
 * first where the network has it, as set for local work or as its file
 * gives it, then the chains its migrations and transfers go to.
 *
 * @returns {import("@reown/appkit/networks").AppKitNetwork[]}
 */
export function evmChains() {
  const net = get(nodeNetwork);
  /** @type {Map<number, import("@reown/appkit/networks").AppKitNetwork>} */
  const chains = new Map();

  if (duskEvm.id) {
    chains.set(
      duskEvm.id,
      appKitChain({
        chainId: duskEvm.id,
        currency: duskEvm.nativeCurrency,
        explorerUrl: String(duskEvm.blockExplorers.default.url ?? ""),
        name: duskEvm.name,
        rpcUrl: duskEvm.rpcUrls.default.http[0],
      })
    );
  }

  for (const { chain } of net ? routes(net) : []) {
    if (!chains.has(chain.chainId)) {
      chains.set(chain.chainId, appKitChain(chain));
    }
  }

  return [...chains.values()];
}

/** Reown's project ID: without one, the Bridge isn't offered. */
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

const blocked = writable(false);

/**
 * Whether connecting a wallet was refused as Reset's delete of the last
 * connection's database waits: on this page's own handle on it, which only
 * a reload closes. A session written meanwhile would go with the delete.
 */
export const connectionBlocked = { subscribe: blocked.subscribe };

/**
 * The EVM wallets' dialog. Opening it starts the connection first, if it
 * isn't yet: a failure to load shows as `connectionFailed`.
 */
export const modal = {
  async open() {
    const reset = resets;

    try {
      await afterCleanup();

      // Reset forgot the wallets since Connect was pressed: nothing opens.
      if (reset !== resets) {
        return;
      }

      await startWalletConnection();
    } catch {
      return;
    }

    if (reset === resets) {
      await appKit?.open();
    }
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

/** No EVM account: before the connection starts, and once forgotten. */
const NO_ACCOUNT = /** @type {import("@wagmi/core").GetAccountReturnType} */ (
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
);

const accountStore = writable(NO_ACCOUNT);

/** The connected EVM account: none until the connection started. */
export const account = { subscribe: accountStore.subscribe };

/** @type {Promise<void> | null} */
let starting = null;

/**
 * Whether the wallets connected here were forgotten, as Reset forgets them:
 * none comes back until someone presses Connect again.
 */
let forgotten = false;

/**
 * How many times Reset forgot the wallets: a start, or a dialog, asked for
 * before one doesn't go on after it.
 */
let resets = 0;

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
  forgotten = false;

  if (!starting) {
    const reset = resets;

    failure.set(false);
    starting = afterCleanup().then(() => start(reset));
    starting.catch(() => {
      starting = null;

      // Refused while Reset's delete waits, which `connectionBlocked` says,
      // or stopped by Reset.
      if (!get(blocked) && reset === resets) {
        failure.set(true);
      }
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
  if (forgotten) {
    return false;
  }

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

/**
 * @param {number} reset Reset's count as the connection started
 */
async function start(reset) {
  const [{ createAppKit }, { WagmiAdapter }] = await Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit-adapter-wagmi"),
  ]);

  // Reset forgot the wallets as AppKit loaded: none of it starts.
  if (reset !== resets) {
    throw new Error("The EVM wallets were forgotten.");
  }

  const chains = evmChains();

  if (!chains.length) {
    throw new Error("This network's bridge reaches no EVM chain.");
  }

  const networks =
    /** @type {[import("@reown/appkit/networks").AppKitNetwork, ...import("@reown/appkit/networks").AppKitNetwork[]]} */ (
      chains
    );
  const wagmiAdapter = new WagmiAdapter({
    networks,
    projectId: VITE_REOWN_PROJECT_ID,
    transports: Object.fromEntries(
      chains.map((chain) => [chain.id, http(chain.rpcUrls.default.http[0])])
    ),
  });

  wagmiConfig = wagmiAdapter.wagmiConfig;
  appKit = createAppKit({
    adapters: [wagmiAdapter],
    defaultNetwork: networks[0],
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
  watchAccount(wagmiConfig, {
    onChange: (next) => {
      // A wallet that comes back after Reset, as a reconnect under way
      // ends, goes again, until someone presses Connect.
      if (reset !== resets && forgotten) {
        if (!next.isDisconnected) {
          void dropConnection();
        }

        return;
      }

      accountStore.set(next);
    },
  });
  window.addEventListener("beforeunload", walletDisconnect);

  // A wallet connected before comes back before the pages use it.
  await Promise.race([
    reconnect(wagmiConfig).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, RECONNECT_WAIT_MS)),
  ]);
}

/**
 * What the EVM wallets' connection keeps in this browser: wagmi's keys,
 * AppKit's (and Web3Modal's, before it), WalletConnect's and the Coinbase
 * SDK's, and WalletConnect's database.
 */
const CONNECTION_KEYS =
  /^(?:wagmi\.|@appkit|@w3m|W3M_|WCM_|wc@2|WALLETCONNECT|-walletlink|cbwsdk)/u;
const CONNECTION_DATABASES = Object.freeze(["WALLET_CONNECT_V2_INDEXED_DB"]);

/**
 * Marks the connection's databases still to delete, until they're gone. A
 * page that loaded the connection holds them open, so the next page deletes
 * them, before any wallet connects.
 */
const FORGET_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-evm-wallets-forgotten`;

/**
 * Deletes a database: true once it's gone, false when that failed. A delete
 * that a connection holds up isn't over: it goes through once the handles
 * on the database close, as they do with the page, and `onBlocked` says it
 * waits meanwhile.
 *
 * @param {string} name
 * @param {() => void} onBlocked
 * @returns {Promise<boolean>}
 */
const deleteDatabase = (name, onBlocked) =>
  new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);

      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = onBlocked;
    } catch {
      // No databases kept here.
      resolve(true);
    }
  });

/**
 * Empties every store of a database, as can be done while it's open; one
 * that isn't there isn't made.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
const emptyDatabase = (name) =>
  new Promise((resolve) => {
    try {
      const request = indexedDB.open(name);

      request.onupgradeneeded = () => request.transaction?.abort();
      request.onerror = () => resolve();
      request.onsuccess = () => {
        const db = request.result;
        const stores = Array.from(db.objectStoreNames);
        const done = () => {
          db.close();
          resolve();
        };

        if (!stores.length) {
          done();

          return;
        }

        const transaction = db.transaction(stores, "readwrite");

        stores.forEach((store) => transaction.objectStore(store).clear());
        transaction.oncomplete = done;
        transaction.onerror = done;
        transaction.onabort = done;
      };
    } catch {
      resolve();
    }
  });

/** The longest a wallet's connecting waits for Reset's delete to be done. */
const CLEANUP_WAIT_MS = 3_000;

/**
 * Reset's delete of the connection's databases while it runs: when it's
 * done, and whether it waits on a handle on them this page keeps.
 *
 * @type {{ done: Promise<void>, isWaiting: boolean, waiting: Promise<void> } | null}
 */
let cleanup = null;

/**
 * Every delete of the connection's databases this page started that isn't
 * over: nothing in the page waits for them (settledDeletes).
 *
 * @type {Set<Promise<void>>}
 */
const deletes = new Set();

/**
 * Deletes the connection's databases, each emptied first, as can be done
 * while a connection holds it open. One held open goes as the page closes,
 * and until then it can't be opened again, so nothing should wait on this.
 * No wallet connects meanwhile (afterCleanup).
 */
function deleteConnectionDatabases() {
  localStorage.setItem(FORGET_KEY, "1");

  const previous = cleanup;
  /** @type {() => void} */
  let markWaiting = () => {};
  const entry = {
    done: Promise.resolve(),
    isWaiting: false,
    waiting: new Promise((resolve) => {
      markWaiting = () => resolve(undefined);
    }),
  };
  const onBlocked = () => {
    entry.isWaiting = true;
    markWaiting();
  };

  // One that waits holds up this one too: it can't start before it's done.
  void previous?.waiting.then(onBlocked);

  entry.done = Promise.all(
    CONNECTION_DATABASES.map(async (name) => {
      await emptyDatabase(name);

      return deleteDatabase(name, onBlocked);
    })
  )
    .then((deleted) => {
      if (deleted.every(Boolean)) {
        localStorage.removeItem(FORGET_KEY);
      }
    })
    .finally(() => {
      deletes.delete(entry.done);

      if (cleanup === entry) {
        cleanup = null;
        blocked.set(false);
      }
    });
  deletes.add(entry.done);
  cleanup = entry;
}

/**
 * Settles once the deletes of the connection's databases this page started
 * are over, those started meanwhile too. The page never waits for them, as
 * one held up by a handle on the database goes only with the page; a test
 * does, so that none outlives it.
 *
 * @returns {Promise<void>}
 */
export async function settledDeletes() {
  while (deletes.size) {
    await Promise.allSettled([...deletes]);
  }
}

/**
 * Waits for Reset's delete of the last connection's database before a
 * wallet connects: a session written before it's done would go with it.
 * Refused, as `connectionBlocked` says, while the delete waits on this
 * page's own handle, which only a reload closes.
 *
 * @returns {Promise<void>}
 */
async function afterCleanup() {
  const entry = cleanup;

  if (!entry) {
    return;
  }

  const waits = await Promise.race([
    entry.done.then(() => false),
    entry.waiting.then(() => true),
    // Neither, as when another tab holds the database: it waits too.
    new Promise((resolve) => setTimeout(() => resolve(true), CLEANUP_WAIT_MS)),
  ]);

  if (waits) {
    blocked.set(true);

    throw new Error("Reload the page to connect a wallet again.");
  }
}

// What Reset forgot in a page that held the connection's database open goes
// now, before any wallet connects.
if (typeof localStorage !== "undefined" && localStorage.getItem(FORGET_KEY)) {
  deleteConnectionDatabases();
}

/**
 * Disconnects a wallet connected now, and deletes what the connection keeps
 * in localStorage.
 */
async function dropConnection() {
  await walletDisconnect().catch(() => {});
  accountStore.set(NO_ACCOUNT);

  for (const key of Object.keys(localStorage)) {
    if (CONNECTION_KEYS.test(key)) {
      localStorage.removeItem(key);
    }
  }
}

/**
 * Forgets every EVM wallet connected here, as Reset does: disconnects one
 * connected now, and deletes what wagmi, AppKit and WalletConnect keep in
 * the browser. No page brings a wallet back after it, or loads the
 * connection, until someone presses Connect. It doesn't wait for the
 * databases, which go in the background, or with the next page.
 *
 * @returns {Promise<void>}
 */
export async function forgetEvmWallets() {
  forgotten = true;
  resets += 1;
  await dropConnection();
  deleteConnectionDatabases();
}

export async function walletDisconnect() {
  if (!wagmiConfig) {
    return;
  }

  /** @type {{ error: unknown } | null} */
  let failed = null;

  try {
    await disconnect(wagmiConfig);
  } catch (error) {
    failed = { error };
  }

  // AppKit's session goes too, even when wagmi's disconnect failed.
  await appKit?.disconnect();

  if (failed) {
    throw failed.error;
  }
}
