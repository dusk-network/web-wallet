import { afterEach, describe, expect, it, vi } from "vitest";

import { duskPrices } from "../duskPrice";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 5, 12);

/** @param {[number, number][]} prices */
const pricesAre = (prices) => {
  /** @type {import("vitest").Mock<(url: string) => Promise<Response>>} */
  const asked = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ prices })))
  );

  vi.stubGlobal("fetch", asked);

  return asked;
};

describe("What a DUSK was worth in euros", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives the price nearest the payment, reading each window of prices once, with no more than its times", async () => {
    const at = NOW - DAY;
    const asked = pricesAre([
      [at - 2 * HOUR, 0.1],
      [at + HOUR, 0.2],
    ]);
    const price = duskPrices({ now: NOW });

    await expect(price({ at })).resolves.toBe(0.2);
    await expect(price({ at: at + 1000 })).resolves.toBe(0.2);

    expect(asked).toHaveBeenCalledOnce();
    expect(asked.mock.lastCall?.[0]).toMatch(
      /^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/dusk-network\/market_chart\/range\?vs_currency=eur&from=\d+&to=\d+$/
    );
  });

  it("knows none too far from the payment, none past the year the public API has, asking nothing for those", async () => {
    const asked = pricesAre([[NOW - 30 * DAY, 0.1]]);
    const price = duskPrices({ now: NOW });

    await expect(price({ at: NOW - 30 * DAY + 4 * HOUR })).resolves.toBeNull();
    expect(asked).toHaveBeenCalledOnce();

    await expect(price({ at: NOW - 366 * DAY })).resolves.toBeNull();
    expect(asked).toHaveBeenCalledOnce();
  });

  it("gets a price for every payment of the past year, asking only for what the public API takes: it refuses a range that starts earlier", async () => {
    const YEAR = 365 * DAY;
    /** @type {number[]} */
    const froms = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (/** @type {string} */ url) => {
        const asked = new URL(url);
        const from = Number(asked.searchParams.get("from")) * 1000;
        const to = Number(asked.searchParams.get("to")) * 1000;

        froms.push(from);

        if (from < NOW - YEAR) {
          return new Response("", { status: 401 });
        }

        // Hourly, as it gives them, over what's asked.
        const prices = [];

        for (let at = from; at <= to; at += HOUR) {
          prices.push([at, 0.25]);
        }

        return new Response(JSON.stringify({ prices }));
      })
    );

    const price = duskPrices({ now: NOW });

    for (let age = 1; age <= 364; age += 7) {
      await expect(price({ at: NOW - age * DAY })).resolves.toBe(0.25);
    }

    await expect(price({ at: NOW - 364 * DAY })).resolves.toBe(0.25);
    await expect(price({ at: NOW - YEAR + 1000 })).resolves.toBe(0.25);
    expect(Math.min(...froms)).toBeGreaterThanOrEqual(NOW - YEAR);
  });

  it("stays within the hourly window of the public API for a clamped range too", async () => {
    const asked = pricesAre([]);

    await duskPrices({ now: NOW })({ at: NOW - 364 * DAY });

    const url = new URL(String(asked.mock.lastCall?.[0]));
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));

    expect(to).toBeGreaterThan(from);
    expect(to - from).toBeLessThanOrEqual(90 * 86_400);
  });

  it("knows none when the request fails, or is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );

    await expect(
      duskPrices({ now: NOW })({ at: NOW - DAY })
    ).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 429 })))
    );

    await expect(
      duskPrices({ now: NOW })({ at: NOW - DAY })
    ).resolves.toBeNull();
  });
});
