/**
 * About what native staking pays a year across the network lately, as
 * `@dusk-network/networks/rates` estimates it from the node's provisioners:
 * read at most once a day per network, and kept in this browser.
 */

import { nativeRateEstimate } from "@dusk-network/networks/rates";

/** How long an estimate is kept: a day. */
const DAY_MS = 86_400_000;

/**
 * @param {string} network
 */
const keyOf = (network) =>
  `${CONFIG.LOCAL_STORAGE_APP_KEY}-native-reward-rate-${network}`;

/**
 * The estimate kept for a network, if it's from the last day.
 *
 * @param {Storage | undefined} storage
 * @param {string} network
 * @param {number} now
 * @returns {{ rate: number | null } | null}
 */
function kept(storage, network, now) {
  try {
    const { at, rate } = JSON.parse(storage?.getItem(keyOf(network)) ?? "{}");

    return typeof at === "number" &&
      now - at >= 0 &&
      now - at < DAY_MS &&
      (rate === null || typeof rate === "number")
      ? { rate }
      : null;
  } catch {
    return null;
  }
}

/** @type {Map<string, Promise<number | null>>} */
const reads = new Map();

/**
 * About what native staking pays a year across the network, as a fraction
 * (0.23 for 23%), or null when nothing is staked or it couldn't be read: the
 * estimate kept from the last day, else one read of the node's provisioners.
 *
 * @param {{
 *   fetch?: typeof fetch,
 *   network: string,
 *   nodeUrl: string,
 *   now?: number,
 *   storage?: Storage,
 *   tipHeight: () => Promise<bigint>,
 * }} options `network` keys what's kept; `tipHeight` the chain's height
 * @returns {Promise<number | null>}
 */
export function readNativeRewardRate({
  fetch: fetchFn = globalThis.fetch,
  network,
  nodeUrl,
  now = Date.now(),
  storage = globalThis.localStorage,
  tipHeight,
}) {
  const known = kept(storage, network, now);

  if (known) {
    return Promise.resolve(known.rate);
  }

  let read = reads.get(network);

  if (!read) {
    read = Promise.all([
      fetchFn(`${nodeUrl}/on/node/provisioners`, { method: "POST" }).then(
        (res) => {
          if (!res.ok) {
            throw new Error(`The provisioners read failed: ${res.status}`);
          }

          return res.json();
        }
      ),
      tipHeight(),
    ]).then(([provisioners, height]) => {
      const rate = nativeRateEstimate({ provisioners, tipHeight: height });

      try {
        storage?.setItem(keyOf(network), JSON.stringify({ at: now, rate }));
      } catch {
        // Read again on the next visit.
      }

      return rate;
    });

    const entry = read;

    reads.set(network, entry);
    // A failed read is tried again the next time; one that worked is kept.
    entry.then(
      () => reads.delete(network),
      () => reads.delete(network)
    );
  }

  return read.catch(() => null);
}

/**
 * A yearly rate as the wallet says it: "23%", in the language's way.
 *
 * @param {number} rate A fraction
 * @param {string} [locale]
 */
export const ratePercent = (rate, locale) =>
  new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(rate);
