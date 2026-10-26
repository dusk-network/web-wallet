import { writable } from "svelte/store";

import networkStore from "./networkStore";

/** How often the price is asked again, in milliseconds: five minutes. */
const REFRESH_INTERVAL = 300_000;

const lowestPrice = BigInt(import.meta.env.VITE_GAS_PRICE_LOWER ?? 1);

/** @param {bigint} price */
const atLeastLowest = (price) => (price > lowestPrice ? price : lowestPrice);

/**
 * The gas price the node gives, in Lux: the median price of the transactions
 * it holds, never under the wallet's lowest. Until the node answers, and
 * while it can't, the price last known, or the configured default.
 */
const { set, subscribe } = writable(
  atLeastLowest(BigInt(import.meta.env.VITE_GAS_PRICE_DEFAULT ?? 1))
);

/** Asks the node for its gas price. */
const refresh = () =>
  networkStore
    .connect()
    .then((network) => network.blocks.gasPrice)
    .then(({ median }) => {
      if (typeof median === "bigint") {
        set(atLeastLowest(median));
      }
    })
    .catch(() => {});

/**
 * Keeps the price up to date until the returned function is called.
 *
 * @returns {() => void}
 */
function startRefreshing() {
  refresh();

  const intervalId = window.setInterval(refresh, REFRESH_INTERVAL);

  return () => window.clearInterval(intervalId);
}

/** @type {GasPriceStore} */
export default { refresh, startRefreshing, subscribe };
