import { describe, expect, it } from "vitest";

import { highFeeText, networkPriceOf, timesNetworkPrice } from "..";

describe("timesNetworkPrice", () => {
  it("says nothing under twice the network's price, as the extension", () => {
    expect(timesNetworkPrice(1n, 1n)).toBeNull();
    expect(timesNetworkPrice(19n, 10n)).toBeNull();
  });

  it("says how many times from twice, to one decimal, rounded down", () => {
    expect(timesNetworkPrice(2n, 1n)).toBe(2);
    expect(timesNetworkPrice(5n, 2n)).toBe(2.5);
    expect(timesNetworkPrice(249n, 100n)).toBe(2.4);
    expect(timesNetworkPrice(50n, 1n)).toBe(50);
    expect(timesNetworkPrice(2_000n, 1n)).toBe(2_000);
  });

  it("says nothing while the network's price isn't known", () => {
    expect(timesNetworkPrice(50n, 0n)).toBeNull();
    expect(timesNetworkPrice(50n, null)).toBeNull();
    expect(timesNetworkPrice(50n, undefined)).toBeNull();
  });
});

describe("networkPriceOf", () => {
  it("is the default price, or what the network asks while it's busy", () => {
    expect(networkPriceOf({ busy: false, median: null, price: 1n })).toBe(1n);
    expect(networkPriceOf({ busy: false, median: 3n, price: 1n })).toBe(1n);
    expect(networkPriceOf({ busy: true, median: 900n, price: 5n })).toBe(900n);
  });
});

describe("highFeeText", () => {
  it("says it in one line, in the extension's words", () => {
    expect(highFeeText(50n, 1n, "en")).toBe(
      "High fee. It's 50 times the network's price.",
    );
    expect(highFeeText(1n, 1n, "en")).toBe("");
  });

  it("writes how many times over in the language's number format", () => {
    expect(highFeeText(5n, 2n, "de-DE")).toBe(
      "High fee. It's 2,5 times the network's price.",
    );
    expect(highFeeText(2_000n, 1n, "en")).toBe(
      "High fee. It's 2,000 times the network's price.",
    );
  });
});
