import { describe, expect, it } from "vitest";

import { isFeatureActiveAt } from "..";

/**
 * Parses the features as the node's JSON sends them,
 * so u64 heights lose precision as they do in the wallet.
 *
 * @param {string} json
 * @returns {unknown}
 */
const parseFeatures = (json) => JSON.parse(json);

const U64_MAX = "18446744073709551615";

describe("isFeatureActiveAt", () => {
  it("should treat an activation height as active from that height on", () => {
    const features = parseFeatures('{ "DISABLE_PHOENIX": 4000000 }');

    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 0n)).toBe(false);
    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 3_999_999n)).toBe(
      false
    );
    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 4_000_000n)).toBe(
      true
    );
    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 4_680_001n)).toBe(
      true
    );
  });

  it("should never treat u64::MAX as an activation height that is reached", () => {
    const features = parseFeatures(`{ "DISABLE_PHOENIX": ${U64_MAX} }`);

    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 5_590_001n)).toBe(
      false
    );
    expect(
      isFeatureActiveAt(
        features,
        "DISABLE_PHOENIX",
        BigInt(Number.MAX_SAFE_INTEGER)
      )
    ).toBe(false);
  });

  it("should treat height ranges as active between their start and end, both included", () => {
    const features = parseFeatures(
      '{ "DISABLE_PHOENIX": [[100, 200], [300, 400]] }'
    );

    /** @type {Array<[bigint, boolean]>} */
    const expectations = [
      [99n, false],
      [100n, true],
      [150n, true],
      [200n, true],
      [201n, false],
      [299n, false],
      [300n, true],
      [400n, true],
      [401n, false],
    ];

    for (const [height, expected] of expectations) {
      expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", height)).toBe(
        expected
      );
    }
  });

  it("should treat a range ending at u64::MAX as active from its start on", () => {
    const features = parseFeatures(
      `{ "DISABLE_PHOENIX": [[2710376, ${U64_MAX}]] }`
    );

    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 2_710_375n)).toBe(
      false
    );
    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 2_710_376n)).toBe(
      true
    );
    expect(
      isFeatureActiveAt(
        features,
        "DISABLE_PHOENIX",
        BigInt(Number.MAX_SAFE_INTEGER)
      )
    ).toBe(true);
  });

  it("should not treat an empty list of ranges as active", () => {
    const features = parseFeatures('{ "DISABLE_PHOENIX": [] }');

    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 1n)).toBe(false);
  });

  it("should not treat a missing feature as active", () => {
    const features = parseFeatures(
      '{ "BLOB": 1814090, "DISABLE_3RD_PARTY": [[2710376, 2873420]] }'
    );

    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 2_800_000n)).toBe(
      false
    );
    expect(isFeatureActiveAt({}, "DISABLE_PHOENIX", 2_800_000n)).toBe(false);
    expect(isFeatureActiveAt(undefined, "DISABLE_PHOENIX", 1n)).toBe(false);
    expect(isFeatureActiveAt(null, "DISABLE_PHOENIX", 1n)).toBe(false);
  });

  it("should match the feature name regardless of case", () => {
    const features = parseFeatures('{ "disable_phoenix": 10 }');

    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 10n)).toBe(true);
    expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 9n)).toBe(false);
  });

  it("should not treat an unreadable activation as active", () => {
    const activations = [
      '"4000000"',
      "-1",
      "1.5",
      "null",
      '{ "Height": 1 }',
      "[[1]]",
      "[[1, 2, 3]]",
      '[["1", "2"]]',
      "[1, 2]",
    ];

    for (const activation of activations) {
      const features = parseFeatures(`{ "DISABLE_PHOENIX": ${activation} }`);

      expect(isFeatureActiveAt(features, "DISABLE_PHOENIX", 5n)).toBe(false);
    }
  });

  it("should read the features as mainnet and testnet nodes report them", () => {
    const mainnet = parseFeatures(
      `{ "DISABLE_3RD_PARTY": [[2710376, 2873420]], "DISABLE_PHOENIX": 4414095, "DISABLE_WASM64": [[2710376, ${U64_MAX}]] }`
    );
    const testnet = parseFeatures(
      `{ "DISABLE_3RD_PARTY": ${U64_MAX}, "DISABLE_PHOENIX": 4000000 }`
    );
    const mainnetNextBlock = 5_590_001n;
    const testnetNextBlock = 4_680_001n;

    expect(
      isFeatureActiveAt(mainnet, "DISABLE_PHOENIX", mainnetNextBlock)
    ).toBe(true);
    expect(
      isFeatureActiveAt(mainnet, "DISABLE_3RD_PARTY", mainnetNextBlock)
    ).toBe(false);
    expect(isFeatureActiveAt(mainnet, "DISABLE_WASM64", mainnetNextBlock)).toBe(
      true
    );
    expect(
      isFeatureActiveAt(testnet, "DISABLE_PHOENIX", testnetNextBlock)
    ).toBe(true);
    expect(
      isFeatureActiveAt(testnet, "DISABLE_3RD_PARTY", testnetNextBlock)
    ).toBe(false);
  });
});
