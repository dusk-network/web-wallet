import { defaultGasPrice } from "@dusk-network/app-core/gas";
import { derived, writable } from "svelte/store";

import networkStore from "./networkStore";

/** How often the price is asked again, in milliseconds: five minutes. */
const REFRESH_INTERVAL = 300_000;

/** How long a price read stays fresh for a form that opens, in milliseconds. */
export const FRESH_FOR = 30_000;

const minimum = BigInt(import.meta.env.VITE_GAS_PRICE_LOWER ?? 1);

/**
 * The default gas price, by the one rule of both wallets
 * (`@dusk-network/app-core/gas`): the median price of the transactions the
 * node holds, never under the wallet's lowest, nor over a ceiling, where the
 * network is busy. Until the node answers, and while it can't, the one last
 * read, or the lowest.
 */
const rule = writable(defaultGasPrice({ minimum }));

/** When the node last gave its price, as Date.now() says it: 0 for never. */
let readAt = 0;

/** Asks the node for its gas price: the median of all it holds. */
const refresh = () =>
  networkStore
    .connect()
    .then((network) => network.blocks.gasPrice)
    .then(({ median }) => {
      if (typeof median === "bigint") {
        rule.set(defaultGasPrice({ median, minimum }));
        readAt = Date.now();
      }
    })
    .catch(() => {});

/**
 * Asks again where the price was read longer ago than `maxAge`, as a form
 * that moves money opens: it starts from what the network asks now.
 *
 * @param {number} [maxAge]
 */
const readAgain = (maxAge = FRESH_FOR) =>
  Date.now() - readAt < maxAge ? Promise.resolve() : refresh();

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
export default {
  readAgain,
  refresh,
  rule: { subscribe: rule.subscribe },
  startRefreshing,
  subscribe: derived(rule, ({ price }) => price).subscribe,
};
