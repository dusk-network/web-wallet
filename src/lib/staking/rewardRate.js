/**
 * About what native staking pays a year: measured from the chain over the
 * last 30 days, as app-core's `nativeRewards` reads it, kept an hour; else as
 * `@dusk-network/networks/rates` estimates it from the node's provisioners
 * and what a block mints, read at most once a day per network, and kept in
 * this browser.
 */

import { nativeRewards } from "@dusk-network/app-core/sozu";
import { nativeRateEstimate } from "@dusk-network/networks/rates";

import { archiveAt } from "$lib/activity/activityHistory";

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

/** How long what's measured is kept: an hour. */
const HOUR_MS = 3_600_000;

/**
 * @typedef {{ days: number | null, native: import("@dusk-network/app-core/sozu").NativeRewards | null, rate: number | null }} NativeRead
 */

/**
 * What's been read of native staking's rewards per network, and when.
 *
 * @type {Map<string, { at: number, read: Promise<NativeRead> }>}
 */
const nativeReads = new Map();

/**
 * Native staking's rewards measured from the chain, else estimated.
 *
 * @param {Parameters<typeof readNativeRewardRate>[0]} options
 * @returns {Promise<NativeRead>}
 */
async function measureNativeRewards(options) {
  const { fetch: fetchFn, nodeUrl, now, tipHeight } = options;
  const [provisioners, height] = await Promise.all([
    readProvisioners({ fetch: fetchFn, nodeUrl }),
    tipHeight().catch(() => null),
  ]);
  const native = provisioners
    ? await nativeRewards({
        archive: archiveAt(nodeUrl),
        now,
        provisioners,
        tipHeight: height,
      }).catch(() => null)
    : null;

  return native
    ? { days: native.days, native, rate: native.rate }
    : { days: null, native: null, rate: await readNativeRewardRate(options) };
}

/**
 * What native staking pays a year, as a fraction, and over what: measured from
 * the chain over the last `days` (app-core's `nativeRewards`, with what it's
 * made of in `native`), or else the estimate (`readNativeRewardRate`), of no
 * period, where that can't be read. A rate of null is none at all. Two reads
 * at once make one, and what's read is kept an hour, unless it's nothing.
 *
 * @param {Parameters<typeof readNativeRewardRate>[0]} options
 * @returns {Promise<NativeRead>}
 */
export function readNativeRewards(options) {
  const { network, now = Date.now() } = options;
  const known = nativeReads.get(network);

  if (known && now - known.at >= 0 && now - known.at < HOUR_MS) {
    return known.read;
  }

  const entry = { at: now, read: measureNativeRewards({ ...options, now }) };

  nativeReads.set(network, entry);
  void entry.read.then(({ rate }) => {
    if (rate === null && nativeReads.get(network) === entry) {
      nativeReads.delete(network);
    }
  });

  return entry.read;
}

/**
 * What the node says of what's staked, for the line of what a rate is made of:
 * null when it couldn't be read.
 *
 * @param {{ fetch?: typeof fetch, nodeUrl: string }} options
 * @returns {Promise<any[] | null>}
 */
export function readProvisioners({
  fetch: fetchFn = globalThis.fetch,
  nodeUrl,
}) {
  return fetchFn(`${nodeUrl}/on/node/provisioners`, { method: "POST" })
    .then((res) => (res.ok ? res.json() : null))
    .then((read) => (Array.isArray(read) ? read : null))
    .catch(() => null);
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
