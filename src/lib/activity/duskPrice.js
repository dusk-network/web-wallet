/**
 * What a DUSK was worth in euros at the time of a payment, for an export that
 * asks for it: CoinGecko's hourly prices, a window of them at a time, read once.
 * Only the times go out, as a range, never an account. Its public API has the
 * past year; older is asked for nothing, and that or a request that fails is no
 * price, which the export says.
 */

const API =
  "https://api.coingecko.com/api/v3/coins/dusk-network/market_chart/range";
const HOUR_MS = 60 * 60_000;

/** Up to 90 days come hourly: what's read with its margins stays within them. */
const WINDOW_MS = 88 * 24 * HOUR_MS;

/** A price further from the payment than this is no price of it. */
const NEAREST_MS = 3 * HOUR_MS;

/** How far back the public API goes: a range that starts earlier, it refuses. */
const PAST_YEAR_MS = 365 * 24 * HOUR_MS;

/** Kept clear of that end: this device's clock isn't the API's. */
const CLOCK_MARGIN_MS = HOUR_MS;

const TIMEOUT_MS = 15_000;

/**
 * A lookup of what one DUSK was worth at a time, in euros: null where it isn't
 * known, its windows read once for this lookup.
 *
 * @param {{ now?: number }} [options]
 * @returns {(asked: { at: number }) => Promise<number | null>}
 */
export function duskEuroPrices({ now = Date.now() } = {}) {
  /** @type {Map<number, Promise<[number, number][]>>} */
  const windows = new Map();
  const earliest = now - PAST_YEAR_MS + CLOCK_MARGIN_MS;

  /** @param {number} start */
  const windowFrom = (start) => {
    let prices = windows.get(start);

    if (!prices) {
      const from = Math.floor(Math.max(start - NEAREST_MS, earliest) / 1000);
      const to = Math.ceil((start + WINDOW_MS + NEAREST_MS) / 1000);

      prices = fetch(`${API}?vs_currency=eur&from=${from}&to=${to}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((read) => (Array.isArray(read?.prices) ? read.prices : []))
        .catch(() => []);
      windows.set(start, /** @type {Promise<[number, number][]>} */ (prices));
    }

    return /** @type {Promise<[number, number][]>} */ (prices);
  };

  return async ({ at }) => {
    if (now - at > PAST_YEAR_MS) {
      return null;
    }

    const prices = await windowFrom(Math.floor(at / WINDOW_MS) * WINDOW_MS);
    /** @type {[number, number] | null} */
    let nearest = null;

    for (const point of prices) {
      if (
        nearest === null ||
        Math.abs(point[0] - at) < Math.abs(nearest[0] - at)
      ) {
        nearest = point;
      }
    }

    return nearest &&
      Math.abs(nearest[0] - at) <= NEAREST_MS &&
      typeof nearest[1] === "number"
      ? nearest[1]
      : null;
  };
}
