/**
 * What a transaction on DuskEVM costs at most. DuskEVM is an OP Stack chain:
 * beside its gas at the gas price, it charges an L1 data fee and an operator
 * fee, which its GasPriceOracle predeploy works out.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

/** DuskEVM's GasPriceOracle predeploy, as on every OP Stack chain. */
export const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";

const ORACLE = parseAbi([
  "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
  "function getOperatorFee(uint256 gasUsed) view returns (uint256)",
]);

/**
 * At most what a type-2 transaction adds around its call data, unsigned: its
 * type, chain, nonce, fees, gas, to and value.
 */
const ENVELOPE_BYTES = 160n;

/**
 * The gas limit a transaction asks the wallet for: the estimate and a fifth
 * more, for what the chain does differently by the time it's mined.
 *
 * @param {bigint} gas
 */
export const duskEvmGasLimit = (gas) => (BigInt(gas) * 6n + 4n) / 5n;

/** A Lux, in wei. */
const LUX_WEI = 1_000_000_000n;

/**
 * The most DuskEVM can charge a transaction, in wei, which is what the chain
 * checks the balance for: its gas limit at the price cap the wallet is asked
 * for, twice the base fee plus the tip; the operator fee at that limit; and
 * the L1 data fee with a margin it can't outrun before the transaction is
 * mined. That fee is a few hundred wei, from an L1 base fee that can move by
 * multiples: twice the oracle's most, and a whole Lux on top. Null without
 * every part; a tip of 0 is one.
 *
 * @param {{ baseFeeWei: bigint | null, l1FeeMaxWei: bigint | null, limit: bigint | null, operatorFeeWei: bigint | null, tipWei: bigint | null }} parts
 * @returns {bigint | null}
 */
export function duskEvmFeeMax({
  baseFeeWei,
  l1FeeMaxWei,
  limit,
  operatorFeeWei,
  tipWei,
}) {
  if (
    baseFeeWei === null ||
    l1FeeMaxWei === null ||
    limit === null ||
    operatorFeeWei === null ||
    tipWei === null
  ) {
    return null;
  }

  return (
    limit * (2n * baseFeeWei + tipWei) +
    operatorFeeWei +
    2n * l1FeeMaxWei +
    LUX_WEI
  );
}

/**
 * @typedef {{
 *   baseFee: () => Promise<bigint | null>,
 *   estimateGas: () => Promise<bigint>,
 *   gasPrice: () => Promise<bigint | null>,
 *   oracle: (data: `0x${string}`) => Promise<`0x${string}` | undefined>,
 *   tip: () => Promise<bigint | null>,
 * }} DuskEvmReads What a quote reads from DuskEVM, for one call: its gas,
 *   the latest block's base fee, the tip and the gas price, and the oracle's
 *   answer to a call of it.
 */

/**
 * @typedef {{
 *   feeWei: bigint | null,
 *   gasLimit: bigint,
 *   maxFeePerGas: bigint | null,
 *   maxPriorityFeePerGas: bigint | null,
 * }} DuskEvmQuote What a call is asked of the wallet with: the gas limit,
 *   from an estimate of that very call, and the price caps, twice the base
 *   fee plus the tip and the tip; and the most the fee can be at them. Null
 *   where a part couldn't be read.
 */

/**
 * What a call on DuskEVM costs at most, as `read` gives the chain's figures.
 * An estimate of the call that can't be had leaves no quote: nothing is sent
 * on a guess.
 *
 * @param {DuskEvmReads} read
 * @param {`0x${string}`} data The call's data
 * @returns {Promise<DuskEvmQuote>}
 */
export async function duskEvmFee(read, data) {
  const quiet = (/** @type {Promise<bigint | null>} */ asked) =>
    asked.catch(() => null);
  const [gas, baseFeeWei, tip, gasPriceWei] = await Promise.all([
    read.estimateGas(),
    quiet(read.baseFee()),
    quiet(read.tip()),
    quiet(read.gasPrice()),
  ]);
  const gasLimit = duskEvmGasLimit(gas);
  const size = BigInt((data.length - 2) / 2) + ENVELOPE_BYTES;

  /**
   * @param {"getL1FeeUpperBound" | "getOperatorFee"} functionName
   * @param {bigint} arg
   */
  const ask = (functionName, arg) =>
    read
      .oracle(encodeFunctionData({ abi: ORACLE, args: [arg], functionName }))
      .then((answer) =>
        answer && answer !== "0x"
          ? /** @type {bigint} */ (
              decodeFunctionResult({ abi: ORACLE, data: answer, functionName })
            )
          : null,
      )
      .catch(() => null);
  const [l1FeeMaxWei, operatorFeeWei] = await Promise.all([
    ask("getL1FeeUpperBound", size),
    ask("getOperatorFee", gasLimit),
  ]);
  // A node without the tip's method: what its gas price is above the base
  // fee, none at all where it's that or under it, as a node's price can be
  // under the latest block's base fee for a moment.
  const tipWei =
    tip ??
    (gasPriceWei !== null && baseFeeWei !== null
      ? gasPriceWei > baseFeeWei
        ? gasPriceWei - baseFeeWei
        : 0n
      : null);
  const priced = baseFeeWei !== null && tipWei !== null;

  return {
    feeWei: duskEvmFeeMax({
      baseFeeWei,
      l1FeeMaxWei,
      limit: gasLimit,
      operatorFeeWei,
      tipWei,
    }),
    gasLimit,
    maxFeePerGas: priced ? 2n * baseFeeWei + tipWei : null,
    maxPriorityFeePerGas: priced ? tipWei : null,
  };
}
