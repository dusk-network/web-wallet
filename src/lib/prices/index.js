/**
 * DUSK's price now in a person's currency, as both wallets read it
 * (`@dusk-network/app-core/prices`), for what an amount comes to beside it:
 * read once for all that show it, again once it's as old as both wallets
 * keep one, and soon after a read that failed, while anything shows it;
 * never off mainnet, as test DUSK has no value.
 */

import { readable } from "svelte/store";
import { networks } from "@dusk-network/networks";
import { PRICE_MAX_AGE_MS, duskPrice } from "@dusk-network/app-core/prices";

export { inCurrency } from "@dusk-network/app-core/prices";

/**
 * Whether DUSK has a price on `network`: on mainnet alone, as test DUSK has
 * no value.
 *
 * @param {import("@dusk-network/networks").Network | null | undefined} network
 */
export const hasPrice = (network) =>
  network?.chainId === networks.mainnet.chainId;

/** How soon a price that couldn't be read is asked for again. */
const RETRY_MS = 30_000;

/**
 * The prices followed, by currency and network.
 *
 * @type {Map<string, import("svelte/store").Readable<import("@dusk-network/app-core/prices").DuskPrice | null>>}
 */
const followed = new Map();

/**
 * DUSK's price in `currency` on `network`, with its time, while anything
 * shows it: null until it's read, and off mainnet, where none is asked for.
 * A read that fails keeps the price before, which says its time.
 *
 * @param {string} currency
 * @param {import("@dusk-network/networks").Network | null | undefined} network
 * @returns {import("svelte/store").Readable<import("@dusk-network/app-core/prices").DuskPrice | null>}
 */
export function priceQuote(currency, network) {
  const key = `${currency}\n${network?.chainId ?? ""}`;
  const known = followed.get(key);

  if (known) {
    return known;
  }

  /** @type {import("@dusk-network/app-core/prices").DuskPrice | null} */
  let quote = null;
  let readAt = -Infinity;

  /**
   * The read under way, whatever shows the price: whether a price was asked
   * for, as none is off mainnet.
   *
   * @type {Promise<boolean> | null}
   */
  let reading = null;

  const read = () =>
    (reading ??= (async () => {
      let isAsked = false;
      const fresh = await duskPrice({
        currency,
        fetch: (...request) => {
          isAsked = true;

          return globalThis.fetch(...request);
        },
        network,
      }).catch(() => null);

      if (fresh) {
        quote = fresh;
        readAt = Date.now();
      }

      return isAsked;
    })().finally(() => {
      reading = null;
    }));

  const price = readable(
    /** @type {import("@dusk-network/app-core/prices").DuskPrice | null} */ (
      null
    ),
    (set) => {
      let isShown = true;

      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let next;

      const follow = () => {
        const age = Date.now() - readAt;

        if (quote && age < PRICE_MAX_AGE_MS) {
          set(quote);
          next = setTimeout(follow, PRICE_MAX_AGE_MS - age);

          return;
        }

        void read().then((isAsked) => {
          if (!isShown) {
            return;
          }

          if (Date.now() - readAt < PRICE_MAX_AGE_MS) {
            follow();
          } else if (isAsked) {
            next = setTimeout(follow, RETRY_MS);
          }
        });
      };

      follow();

      return () => {
        isShown = false;
        clearTimeout(next);
      };
    }
  );

  followed.set(key, price);

  return price;
}
