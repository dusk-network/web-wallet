import { afterEach, describe, expect, it, vi } from "vitest";

import { duskEuroPrices } from "../duskPrice";

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
    const price = duskEuroPrices({ now: NOW });

    await expect(price({ at })).resolves.toBe(0.2);
    await expect(price({ at: at + 1000 })).resolves.toBe(0.2);

    expect(asked).toHaveBeenCalledOnce();
    expect(asked.mock.lastCall?.[0]).toMatch(
      /^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/dusk-network\/market_chart\/range\?vs_currency=eur&from=\d+&to=\d+$/
    );
  });

  it("knows none too far from the payment, none past the year the public API has, asking nothing for those", async () => {
    const asked = pricesAre([[NOW - 30 * DAY, 0.1]]);
    const price = duskEuroPrices({ now: NOW });

    await expect(price({ at: NOW - 30 * DAY + 4 * HOUR })).resolves.toBeNull();
    expect(asked).toHaveBeenCalledOnce();

    await expect(price({ at: NOW - 366 * DAY })).resolves.toBeNull();
    expect(asked).toHaveBeenCalledOnce();
  });

  it("knows none when the request fails, or is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );

    await expect(
      duskEuroPrices({ now: NOW })({ at: NOW - DAY })
    ).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 429 })))
    );

    await expect(
      duskEuroPrices({ now: NOW })({ at: NOW - DAY })
    ).resolves.toBeNull();
  });
});
