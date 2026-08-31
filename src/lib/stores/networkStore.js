import { writable } from "svelte/store";
import { browser } from "$app/environment";
import {
  AccountSyncer,
  AddressSyncer,
  Network,
  useAsProtocolDriver,
} from "@dusk/w3sper";

import { rejectAfter } from "$lib/dusk/promise";
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

/** @type {Network} */
const network = new Network(networkUrl);

/** @type {NetworkStoreContent} */
const initialState = {
  get connected() {
    return network.connected;
  },
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

/** @type {NetworkStoreServices["connect"]} */
const connect = async () =>
  network.connected
    ? network
    : Promise.race([
        fetch(wasmPath)
          .then((response) => response.arrayBuffer())
          .then((buffer) => {
            useAsProtocolDriver(new Uint8Array(buffer));

            return network.connect();
          }),
        rejectAfter(
          10000,
          new Error("Timed out while connecting to the network")
        ),
      ]);

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

/** @type {NetworkStoreServices["getCurrentBlockHeight"]} */
const getCurrentBlockHeight = () => network.blockHeight;

/** @type {NetworkStoreServices["getLatestBlockTimestamp"]} */
const getLatestBlockTimestamp = () =>
  connect()
    .then(() => network.query("block(height: -1) { header { timestamp } }"))
    .then((body) => {
      const timestamp = body?.block?.header?.timestamp;

      if (timestamp === null || timestamp === undefined) {
        throw new Error("Latest block timestamp is unavailable");
      }

      return BigInt(timestamp);
    });

/** @type {NetworkStoreServices["getLastFinalizedBlockHeight"]} */
const getLastFinalizedBlockHeight = () =>
  connect()
    .then(() => network.query("lastBlockPair { json }"))
    .then((data) => data?.lastBlockPair?.json?.last_finalized_block?.[0])
    .then((height) => (height === undefined ? 0n : BigInt(height)));

/** @type {NetworkStoreServices["init"]} */
async function init() {
  const info = await network.node.info;

  set({
    ...initialState,
    networkName: info.chain.toString(),
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
  getLatestBlockTimestamp,
  init,
  registerDataDriver,
  subscribe,
};
