import { describe, expect, it } from "vitest";

import {
  formatDusk,
  formatDuskExact,
  formatDuskPlain,
  formatFee,
  formatTotal,
} from "..";

describe("formatDusk", () => {
  it("shows amounts in one format: at most 4 decimals, no trailing zeros, thousands grouped", () => {
    expect(formatDusk("174559603271", "en")).toBe("174.5596");
    expect(formatDusk("1484923500000", "en")).toBe("1,484.9235");
    expect(formatDusk("1000000000000", "en")).toBe("1,000");
    expect(formatDusk("1100020000", "en")).toBe("1.1");
    expect(formatDusk("2000010000", "en")).toBe("2");
    expect(formatDusk(100_000_000n, "en")).toBe("0.1");
    expect(formatDusk(-25_000_000_000n, "en")).toBe("−25");

    // Under 0.01: two significant digits, never zero.
    expect(formatDusk("40000", "en")).toBe("0.00004");
    expect(formatDusk("2151569", "en")).toBe("0.0021");
    expect(formatDusk("0", "en")).toBe("0");
  });

  it("writes the number as the language does", () => {
    expect(formatDusk("1234567890123", "de")).toBe("1.234,5678");
    // French groups with a narrow no-break space.
    expect(formatDusk("1234567890123", "fr")).toBe("1\u202f234,5678");
    expect(formatDusk("1234567890123", "ar-EG")).toBe("١٬٢٣٤٫٥٦٧٨");
  });
});

describe("formatDuskExact", () => {
  it("shows an amount under review exactly, every decimal of it", () => {
    expect(formatDuskExact("1234567891234", "en")).toBe("1,234.567891234");
    expect(formatDuskExact("100000000", "en")).toBe("0.1");
    expect(formatDuskExact(25_000_000_000n, "de")).toBe("25");
  });
});

describe("formatTotal", () => {
  it("rounds a total up as fees are, but never past the balance as it shows", () => {
    // 173.901884001 DUSK shows as 173.9018, rounded down as balances are:
    // a total at Max, or just under it, reads the same, not more.
    expect(formatTotal(173_901_884_001n, 173_901_884_001n, "en")).toBe(
      "173.9018"
    );
    expect(
      formatTotal(173_899_384_001n + 2_500_000n, 173_901_884_001n, "en")
    ).toBe("173.9018");
    expect(formatTotal(173_901_800_001n, 173_901_884_001n, "en")).toBe(
      "173.9018"
    );
    expect(formatTotal(1_002_500_000n, 173_901_884_001n, "en")).toBe("1.0025");
    expect(formatTotal(1_000_000_001n, 173_901_884_001n, "en")).toBe("1.0001");
    // More than there is reads more.
    expect(formatTotal(173_901_884_002n, 173_901_884_001n, "en")).toBe(
      "173.9019"
    );
    expect(formatTotal(0n, 0n, "en")).toBe("0");
  });
});

describe("formatFee", () => {
  it("shows a fee exactly up to 4 decimals, rounding a maximum up and a fee paid to the nearest", () => {
    /** @param {string} lux */
    const both = (lux) => [
      formatFee(lux, "en"),
      formatFee(lux, "en", { max: true }),
    ];

    expect(both("2500000")).toEqual(["0.0025", "0.0025"]);
    expect(both("1840001")).toEqual(["0.0018", "0.0019"]);
    expect(both("1853542")).toEqual(["0.0019", "0.0019"]);
    expect([formatFee("1849999", "en"), formatFee("1850000", "en")]).toEqual([
      "0.0018",
      "0.0019",
    ]);
    expect(formatFee("50000000", "en")).toBe("0.05");
    expect(formatFee("1500000000000", "en")).toBe("1,500");

    // Under 0.01: two significant digits, a maximum rounded up.
    expect(both("40000")).toEqual(["0.00004", "0.00004"]);
    expect(both("1234")).toEqual(["0.0000012", "0.0000013"]);
    expect(formatFee("0", "en", { max: true })).toBe("0");
  });
});

describe("formatDuskPlain", () => {
  it("writes every decimal with a point and no grouping, for a file", () => {
    expect(formatDuskPlain(-1_234_567_891_234n)).toBe("-1234.567891234");
    expect(formatDuskPlain("25000000000")).toBe("25");
    expect(formatDuskPlain(0n)).toBe("0");
  });
});
