import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { networkFor } from "@dusk-network/networks";
import {
  AccountSyncer,
  AddressSyncer,
  useAsProtocolDriver,
} from "@dusk/w3sper";

import SendingNetwork from "$lib/transactions/SendingNetwork";

import { setNodeNetwork } from "./nodeNetwork";
import { makeNodeUrl } from "$lib/url";

import wasmPath from "$lib/vendor/wallet_core-1.6.0.wasm?url";

function getNetworkUrl() {
  if (browser) {
    return makeNodeUrl();
  } else {
    return (
      (import.meta.env.VITE_NODE_URL &&
        new URL(import.meta.env.VITE_NODE_URL)) ||
      new URL("https://localhost")
    );
  }
}

const networkUrl = getNetworkUrl();

/**
 * The node's network, which marks what a send ran into once its
 * transaction may have gone out (SendingNetwork).
 */
const network = new SendingNetwork(networkUrl);

/** How long connecting, or the node's saying what it is, can take. */
const CONNECT_TIMEOUT = 10_000;

/** How long the node gets to say what it is before it's asked again. */
const ASK_AGAIN_AFTER = 3000;

/**
 * The attempt to connect under way, which whoever needs the network shares.
 *
 * @type {{ promise: Promise<any>, stop: (reason: Error) => void } | null}
 */
let attempt = null;

/**
 * Where this browser keeps the name of the network the node gave last, for
 * the pages shown while it can't be reached.
 */
const LAST_NETWORK = `${CONFIG.LOCAL_STORAGE_APP_KEY}-network`;

/** @returns {string} */
function readLastNetwork() {
  try {
    return globalThis.localStorage?.getItem(LAST_NETWORK) || "unknown";
  } catch {
    return "unknown";
  }
}

/** @type {NetworkStoreContent} */
const initialState = {
  chainId: null,
  get connected() {
    return network.connected;
  },
  lastNetworkName: readLastNetwork(),
  net: null,
  networkName: "unknown",
};

const networkStore = writable(initialState);
const { set, subscribe } = networkStore;

/**
 * Checks if a block with the given height and hash
 * exists on the network.
 *
 * @type {NetworkStoreServices["checkBlock"]}
 */
const checkBlock = (height, hash) =>
  connect()
    .then(() => network.query(`checkBlock(height: ${height}, hash: "${hash}")`))
    .then(({ checkBlock: result }) => result);

/**
 * Starts an attempt to connect: wallet core first, as w3sper would otherwise
 * ask the node for it, then the socket. One that fails leaves nothing behind
 * for the next one to wait for.
 */
function startConnecting() {
  /** @type {PromiseWithResolvers<never>} */
  const { promise: stopped, reject: stop } = Promise.withResolvers();
  const timer = setTimeout(
    () => stop(new Error("Timed out while connecting to the network")),
    CONNECT_TIMEOUT
  );
  let isOver = false;

  const promise = Promise.race([
    fetch(wasmPath)
      .then((response) => {
        // What isn't the wallet core would stay loaded as if it were.
        if (!response.ok) {
          throw new Error("The wallet core couldn't be loaded");
        }

        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (isOver) {
          return network;
        }

        useAsProtocolDriver(new Uint8Array(buffer));

        return network.connect();
      }),
    stopped,
  ])
    .catch(async (error) => {
      isOver = true;

      await network.abandon();

      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      attempt = null;
    });

  attempt = { promise, stop };

  return promise;
}

/** @type {NetworkStoreServices["connect"]} */
const connect = async () =>
  attempt ? attempt.promise : network.connected ? network : startConnecting();

/**
 * Connects anew, not waiting any longer for the attempt under way, if any.
 *
 * @type {NetworkStoreServices["reconnect"]}
 */
const reconnect = async () => {
  if (attempt) {
    const { promise, stop } = attempt;

    stop(new Error("Stopped to try again"));

    await promise.catch(() => {});
  }

  return connect();
};

/** @type {NetworkStoreServices["disconnect"]} */
const disconnect = () => network.disconnect();

/** @type {() => Promise<AccountSyncer>} */
const getAccountSyncer = () => connect().then(() => new AccountSyncer(network));

/** @type {() => Promise<AddressSyncer>} */
const getAddressSyncer = () => connect().then(() => new AddressSyncer(network));

/** @type {NetworkStoreServices["getBlockHashByHeight"]} */
const getBlockHashByHeight = (height) =>
  connect()
    .then(() => network.query(`block(height: ${height}) { header { hash } }`))
    .then((data) => data?.block?.header?.hash ?? "");

/**
 * The latest block's height; aborting the signal given stops the request.
 *
 * @type {NetworkStoreServices["getCurrentBlockHeight"]}
 */
const getCurrentBlockHeight = (signal) =>
  signal
    ? network
        .query("block(height: -1) { header { height } }", { signal })
        .then((body) => BigInt(body?.block?.header?.height ?? 0))
    : network.blockHeight;

/**
 * The latest block's height and time: what contract times are counted from.
 *
 * @type {NetworkStoreServices["getLatestBlock"]}
 */
const getLatestBlock = () =>
  connect()
    .then(() =>
      network.query("block(height: -1) { header { height timestamp } }")
    )
    .then((body) => {
      const { height, timestamp } = body?.block?.header ?? {};

      if (
        height === null ||
        height === undefined ||
        timestamp === null ||
        timestamp === undefined
      ) {
        throw new Error("The latest block is unavailable");
      }

      return { height: BigInt(height), timestamp: BigInt(timestamp) };
    });

/** @type {NetworkStoreServices["getLastFinalizedBlockHeight"]} */
const getLastFinalizedBlockHeight = () =>
  connect()
    .then(() => network.query("lastBlockPair { json }"))
    .then((data) => data?.lastBlockPair?.json?.last_finalized_block?.[0])
    .then((height) => (height === undefined ? 0n : BigInt(height)));

/**
 * What the node says it is, needing no socket. A request that gets no answer
 * doesn't hold everything up: it's asked again meanwhile, and after the time
 * connecting has, there's no answer.
 *
 * @returns {Promise<any>}
 */
function readNodeInfo() {
  /** @type {PromiseWithResolvers<any>} */
  const { promise, reject, resolve } = Promise.withResolvers();
  const ask = () => Promise.resolve(network.node.info).then(resolve, reject);
  const asking = setInterval(ask, ASK_AGAIN_AFTER);
  const timer = setTimeout(
    () => reject(new Error("Timed out while connecting to the network")),
    CONNECT_TIMEOUT
  );

  ask();

  return promise.finally(() => {
    clearInterval(asking);
    clearTimeout(timer);
  });
}

/**
 * Names the network by the chain ID its node gives, never by its address:
 * a custom node of a network gets that network's contracts and routes.
 *
 * @type {NetworkStoreServices["init"]}
 */
async function init() {
  const info = await readNodeInfo();
  const chainId = Number(info.chainId);
  const net = networkFor(chainId);
  const networkName = info.chain.toString();

  try {
    localStorage.setItem(LAST_NETWORK, networkName);
  } catch {
    // Kept for this page only.
  }

  setNodeNetwork(net);
  set({
    ...initialState,
    chainId,
    lastNetworkName: networkName,
    net,
    networkName,
  });
}

/** @type {NetworkStoreServices["registerDataDriver"]} */
const registerDataDriver = (id, driver) =>
  connect().then(() => network.dataDrivers.register(id, driver));

/** @type {NetworkStore} */
export default {
  checkBlock,
  connect,
  disconnect,
  getAccountSyncer,
  getAddressSyncer,
  getBlockHashByHeight,
  getCurrentBlockHeight,
  getLastFinalizedBlockHeight,
  getLatestBlock,
  init,
  reconnect,
  registerDataDriver,
  subscribe,
};
