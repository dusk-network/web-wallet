import { defaultGasPrice } from "@dusk-network/app-core/gas";
import { derived, writable } from "svelte/store";

import networkStore from "./networkStore";

/** How often the price is asked again, in milliseconds: five minutes. */
const REFRESH_INTERVAL = 300_000;

/**
 * How long a price read stays fresh for a form that opens, or a Review, in
 * milliseconds.
 */
export const FRESH_FOR = 30_000;

/** How long the node gets to answer, in milliseconds. */
const ANSWER_WITHIN = 10_000;

const minimum = BigInt(import.meta.env.VITE_GAS_PRICE_LOWER ?? 1);

/**
 * The default gas price, by the one rule of both wallets
 * (`@dusk-network/app-core/gas`), from what waits in the node's mempool: the
 * lowest while it fits in the next block, else the median price of what
 * waits, never under the lowest, nor over a ceiling, where the network is
 * busy. Until the node answers, and while it can't, the one last read, or
 * the lowest.
 */
const rule = writable(defaultGasPrice({ minimum }));

/** When the node last gave its price, as Date.now() says it: 0 for never. */
let readAt = 0;

/**
 * The read under way: one at a time, as a node that holds requests open
 * would otherwise use up the browser's connections to it.
 *
 * @type {Promise<void> | null}
 */
let reading = null;

/**
 * Asks the node what waits in its mempool, and at what gas price: given up
 * where it doesn't answer within ANSWER_WITHIN, the price as read last.
 *
 * @returns {Promise<void>}
 */
const refresh = () =>
  (reading ??= new Promise((resolve) => {
    const controller = new AbortController();
    const deadline = window.setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, ANSWER_WITHIN);

    networkStore
      .connect()
      .then((network) =>
        network.query("mempoolTxs { gasPrice gasLimit }", {
          signal: controller.signal,
        })
      )
      .then(({ mempoolTxs }) => {
        if (!controller.signal.aborted && Array.isArray(mempoolTxs)) {
          rule.set(defaultGasPrice({ mempool: mempoolTxs, minimum }));
          readAt = Date.now();
        }
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(deadline);
        resolve(undefined);
      });
  }).then(() => {
    reading = null;
  }));

/**
 * Asks again where the price was read longer ago than `maxAge`, as a form
 * that moves money opens: it starts from what the network asks now.
 *
 * @param {number} [maxAge]
 */
const readAgain = (maxAge = FRESH_FOR) =>
  Date.now() - readAt < maxAge ? Promise.resolve() : refresh();

/**
 * Keeps the price read within FRESH_FOR while a form that moves money shows,
 * as the extension reads it as each Review opens: the form takes each price
 * read, unless its gas was edited, so its Review opens with one no older.
 * Until the returned function is called.
 *
 * @returns {() => void}
 */
function keepFresh() {
  readAgain();

  const intervalId = window.setInterval(refresh, FRESH_FOR);

  return () => window.clearInterval(intervalId);
}

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
  keepFresh,
  readAgain,
  refresh,
  rule: { subscribe: rule.subscribe },
  startRefreshing,
  subscribe: derived(rule, ({ price }) => price).subscribe,
};
