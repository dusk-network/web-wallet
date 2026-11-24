import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, parseAbi } from "viem";

import {
  GAS_PRICE_ORACLE,
  duskEvmFee,
  duskEvmFeeMax,
  duskEvmGasLimit,
} from "../duskEvmFee";

const ORACLE = parseAbi([
  "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
  "function getOperatorFee(uint256 gasUsed) view returns (uint256)",
]);

/** A withdrawal's call data as testnet's went out: 356 bytes. */
const DATA = /** @type {`0x${string}`} */ (`0x${"ab".repeat(356)}`);

/**
 * What the GasPriceOracle answers on testnet: an L1 data fee of 379 wei at
 * most, and Jovian's operator fee, gas × 1,328,571,429 × 100 + 0.002 DUSK.
 */
const oracleOf = () =>
  vi.fn(async (/** @type {`0x${string}`} */ data) => {
    const { args, functionName } = decodeFunctionData({ abi: ORACLE, data });

    return /** @type {`0x${string}`} */ (
      encodeAbiParameters(
        [{ type: "uint256" }],
        [
          functionName === "getL1FeeUpperBound"
            ? 379n
            : BigInt(args[0]) * 1_328_571_429n * 100n + 2_000_000_000_000_000n,
        ],
      )
    );
  });

/**
 * DuskEVM's reads, as testnet answered them: a base fee of 10 gwei and a tip
 * of 0.001, and its oracle's.
 *
 * @param {Partial<import("../duskEvmFee").DuskEvmReads>} [reads]
 * @returns {import("../duskEvmFee").DuskEvmReads}
 */
const testnet = (reads) => ({
  baseFee: async () => 10_000_000_000n,
  estimateGas: async () => 142_972n,
  gasPrice: async () => 10_001_000_000n,
  oracle: oracleOf(),
  tip: async () => 1_000_000n,
  ...reads,
});

describe("DuskEVM's fee", () => {
  it("asks the wallet for the estimate and a fifth more", () => {
    expect(duskEvmGasLimit(142_972n)).toBe(171_567n);
    expect(duskEvmGasLimit(138_463n)).toBe(166_156n);
    expect(duskEvmGasLimit(5n)).toBe(6n);
  });

  // Testnet's withdrawal 0x04a8a897… (block 3,090,013), read as of the
  // block before it: estimated at 142,972 gas, it used 138,439 and was
  // charged 0.021777138444933323 DUSK in all, its gas at its price only
  // 0.001384528439.
  it("is the most the chain can charge at that limit: its gas at twice the base fee and the tip, the price caps asked for, the operator fee, and the L1 fee twice and a Lux", async () => {
    const oracle = oracleOf();
    const quote = await duskEvmFee(testnet({ oracle }), DATA);

    expect(quote).toStrictEqual({
      // 171,567 × 20.001 gwei, 0.0247939 DUSK, and twice 379 wei and a Lux.
      feeWei: 28_225_414_002_925_058n,
      gasLimit: 171_567n,
      maxFeePerGas: 20_001_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
    });
    expect(quote.feeWei).toBeGreaterThanOrEqual(21_777_138_444_933_323n);
    // The oracle's reads: the L1 fee for the call and its envelope, 516
    // bytes, and the operator fee at the gas limit.
    expect(
      oracle.mock.calls.map(([data]) => {
        const { args, functionName } = decodeFunctionData({
          abi: ORACLE,
          data,
        });

        return [functionName, args[0]];
      }),
    ).toStrictEqual([
      ["getL1FeeUpperBound", 516n],
      ["getOperatorFee", 171_567n],
    ]);
    expect(GAS_PRICE_ORACLE).toBe("0x420000000000000000000000000000000000000F");
  });

  it("takes the tip as what the gas price is above the base fee where the node can't say it", async () => {
    const quote = await duskEvmFee(
      testnet({ tip: () => Promise.reject(new Error("Method not found")) }),
      DATA,
    );

    expect(quote.feeWei).toBe(28_225_414_002_925_058n);
  });

  it("takes a gas price no more than the base fee as a tip of 0, which is one", async () => {
    const quote = await duskEvmFee(
      testnet({
        gasPrice: async () => 10_000_000_000n,
        tip: () => Promise.reject(new Error("Method not found")),
      }),
      DATA,
    );

    expect(quote).toMatchObject({
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 0n,
    });
    expect(quote.feeWei).toBe(
      171_567n * 20_000_000_000n +
        24_793_901_435_924_300n +
        2n * 379n +
        1_000_000_000n,
    );
  });

  it("takes a gas price under the base fee as a tip of 0 too, as a node's price can lag the latest block's base fee", async () => {
    const quote = await duskEvmFee(
      testnet({
        gasPrice: async () => 9_999_999_999n,
        tip: () => Promise.reject(new Error("Method not found")),
      }),
      DATA,
    );

    expect(quote).toMatchObject({
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 0n,
    });
    expect(quote.feeWei).toBe(
      171_567n * 20_000_000_000n +
        24_793_901_435_924_300n +
        2n * 379n +
        1_000_000_000n,
    );
  });

  it("keeps twice the L1 fee and a Lux on top, which a jump in it before it's mined can't outrun", () => {
    expect(
      duskEvmFeeMax({
        baseFeeWei: 0n,
        l1FeeMaxWei: 379n,
        limit: 1n,
        operatorFeeWei: 0n,
        tipWei: 0n,
      }),
    ).toBe(1_000_000_758n);
  });

  it("is no figure without every part", async () => {
    for (const reads of [
      { baseFee: async () => null },
      { baseFee: () => Promise.reject(new Error("Unreachable")) },
      {
        gasPrice: async () => null,
        tip: () => Promise.reject(new Error("Method not found")),
      },
      { oracle: async () => /** @type {`0x${string}`} */ ("0x") },
      { oracle: () => Promise.reject(new Error("Unreachable")) },
    ]) {
      expect((await duskEvmFee(testnet(reads), DATA)).feeWei).toBeNull();
    }

    expect(
      duskEvmFeeMax({
        baseFeeWei: 1n,
        l1FeeMaxWei: 1n,
        limit: 1n,
        operatorFeeWei: null,
        tipWei: 1n,
      }),
    ).toBeNull();
  });

  it("goes no further where the gas can't be estimated", async () => {
    await expect(
      duskEvmFee(
        testnet({ estimateGas: () => Promise.reject(new Error("Reverted")) }),
        DATA,
      ),
    ).rejects.toThrow("Reverted");
  });
});
