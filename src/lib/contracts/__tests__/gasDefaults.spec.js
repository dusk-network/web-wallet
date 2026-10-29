import { describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { gasStore } from "$lib/stores";

import {
  GAS_DEFAULTS,
  HIGHEST_DEFAULT_GAS_LIMIT,
  LOWEST_GAS_LIMIT_MINIMUM,
  areValidGasSettings,
  followDefaultGas,
  getGasLimits,
  getGasSettings,
} from "..";

describe("gas defaults", () => {
  const entries = Object.values(GAS_DEFAULTS);

  it("should give each operation the default and minimum the extension uses", () => {
    expect(GAS_DEFAULTS).toMatchObject({
      allocate: { limit: 50_000_000n, minimum: 30_000_000n },
      bridge: { limit: 5_000_000n, minimum: 2_500_000n },
      "claim-rewards": { limit: 50_000_000n, minimum: 35_000_000n },
      // Sozu: a stake spends 2.2M, an unstake up to 6.3M.
      "liquid-stake": { limit: 5_000_000n, minimum: 2_500_000n },
      "liquid-unstake": { limit: 10_000_000n, minimum: 4_000_000n },
      "public-transfer": { limit: 2_500_000n, minimum: 2_000_000n },
      shield: { limit: 50_000_000n, minimum: 30_000_000n },
      "shielded-transfer": { limit: 50_000_000n, minimum: 30_000_000n },
      stake: { limit: 50_000_000n, minimum: 35_000_000n },
      unshield: { limit: 50_000_000n, minimum: 30_000_000n },
      unstake: { limit: 50_000_000n, minimum: 35_000_000n },
    });
  });

  it("should keep every default valid for its own operation", () => {
    const bounds = get(gasStore);

    for (const [operation, { limit }] of Object.entries(GAS_DEFAULTS)) {
      expect(
        areValidGasSettings(
          bounds.gasPriceLower,
          limit,
          getGasLimits(/** @type {GasOperation} */ (operation), bounds)
        )
      ).toBe(true);
    }
  });

  it("should cover both directions of an allocation", () => {
    const { allocate, shield, unshield } = GAS_DEFAULTS;

    for (const { limit, minimum } of [shield, unshield]) {
      expect(allocate.limit).toBeGreaterThanOrEqual(limit);
      expect(allocate.minimum).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("should expose the lowest minimum and the highest default", () => {
    expect(LOWEST_GAS_LIMIT_MINIMUM).toBe(2_000_000n);
    expect(HIGHEST_DEFAULT_GAS_LIMIT).toBe(50_000_000n);

    for (const { limit, minimum } of entries) {
      expect(LOWEST_GAS_LIMIT_MINIMUM).toBeLessThanOrEqual(minimum);
      expect(HIGHEST_DEFAULT_GAS_LIMIT).toBeGreaterThanOrEqual(limit);
    }
  });

  it("should start an operation from its default limit and the node's price without custom gas", () => {
    const noCustomGas = { customGasLimit: null, customGasPrice: null };

    expect(getGasSettings("public-transfer", noCustomGas, 3n)).toStrictEqual({
      gasLimit: 2_500_000n,
      gasPrice: 3n,
    });
    expect(getGasSettings("shielded-transfer", noCustomGas, 1n)).toStrictEqual({
      gasLimit: 50_000_000n,
      gasPrice: 1n,
    });
  });

  it("should start an operation from the custom gas limit and price if there are some", () => {
    expect(
      getGasSettings(
        "stake",
        { customGasLimit: 70_000_000n, customGasPrice: 2n },
        1n
      )
    ).toStrictEqual({ gasLimit: 70_000_000n, gasPrice: 2n });
  });

  it("should follow new default gas in a form, unless the gas was edited there", () => {
    const previous = { gasLimit: 50_000_000n, gasPrice: 1n };
    const next = { gasLimit: 50_000_000n, gasPrice: 3n };

    expect(followDefaultGas({ ...previous }, previous, next)).toStrictEqual(
      next
    );

    const edited = { gasLimit: 50_000_000n, gasPrice: 2n };

    expect(followDefaultGas(edited, previous, next)).toBe(edited);
  });

  it("should give an operation its own minimum and keep the global bounds", () => {
    const bounds = {
      gasLimitLower: 1n,
      gasLimitUpper: 900_000_000n,
      gasPriceLower: 2n,
    };

    expect(getGasLimits("stake", bounds)).toStrictEqual({
      gasLimitLower: 35_000_000n,
      gasLimitUpper: 900_000_000n,
      gasPriceLower: 2n,
    });
  });
});
