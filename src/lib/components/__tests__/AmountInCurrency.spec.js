import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";
import { PRICE_MAX_AGE_MS } from "@dusk-network/app-core/prices";

import { settingsStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import AmountInCurrency from "../AmountInCurrency/AmountInCurrency.svelte";

/**
 * The price source's answer, with DUSK's price in `currency`.
 *
 * @param {string} currency
 * @param {number} price
 */
const answer = (currency, price) => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({
      market_data: {
        current_price: { [currency]: price },
        last_updated: "2026-11-13T12:03:00.000Z",
      },
    }),
});

describe("AmountInCurrency", () => {
  /** The price source, asked. */
  const prices = vi.fn();

  /** @param {HTMLElement} container */
  const shown = (container) =>
    container.querySelector(".amount-in-currency")?.textContent?.trim();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", prices);
    setNodeNetwork(networks.mainnet);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    settingsStore.reset();
    setNodeNetwork(null);
    prices.mockReset();
  });

  it("reads the price once an amount shows, again once it's five minutes old, and not as the amount changes", async () => {
    settingsStore.update((store) => ({ ...store, currency: "USD" }));
    prices.mockResolvedValue(answer("usd", 0.5));

    // No amount yet: no price asked for.
    const { container, rerender } = render(AmountInCurrency, { lux: null });

    await vi.advanceTimersByTimeAsync(0);

    expect(prices).not.toHaveBeenCalled();

    await rerender({ lux: 2_000_000_000n });
    await vi.waitFor(() =>
      expect(shown(container)).toMatch(/^≈ \$1\.00 · price at /)
    );

    // As the amount is typed: what it comes to, at the same price.
    await rerender({ lux: 4_000_000_000n });

    expect(shown(container)).toMatch(/^≈ \$2\.00 · price at /);
    expect(prices).toHaveBeenCalledOnce();

    // Five minutes on, while it still shows: the price now.
    prices.mockResolvedValue(answer("usd", 0.75));
    await vi.advanceTimersByTimeAsync(PRICE_MAX_AGE_MS);

    await vi.waitFor(() =>
      expect(shown(container)).toMatch(/^≈ \$3\.00 · price at /)
    );
    expect(prices).toHaveBeenCalledTimes(2);
  });

  it("asks again soon after the price couldn't be read, and says what the amount comes to once it is", async () => {
    settingsStore.update((store) => ({ ...store, currency: "CHF" }));
    prices.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "",
    });

    const { container } = render(AmountInCurrency, { lux: 2_000_000_000n });

    await vi.waitFor(() => expect(prices).toHaveBeenCalledOnce());

    expect(shown(container)).toBeUndefined();

    prices.mockResolvedValue(answer("chf", 0.5));
    await vi.advanceTimersByTimeAsync(30_000);

    await vi.waitFor(() =>
      expect(shown(container)).toMatch(/^≈ CHF\s1\.00 · price at /)
    );
    expect(prices).toHaveBeenCalledTimes(2);
  });
});
