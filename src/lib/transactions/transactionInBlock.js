/**
 * A transaction as the block that took it says it, as the node has it now,
 * final or not: its height, its time, what went wrong there, and the fee it
 * was charged. Null where no block has it.
 *
 * @param {Pick<import("@dusk/w3sper").Network, "query">} network
 * @param {string} hash
 * @param {AbortSignal} [signal]
 * @returns {Promise<import("./followTransaction").FinalTransaction | null>}
 */
export default async function transactionInBlock(network, hash, signal) {
  const { tx } =
    (await network.query(
      `tx(hash: "${hash}") { blockHeight blockTimestamp err gasSpent tx { gasPrice } }`,
      { signal }
    )) ?? {};

  if (!tx) {
    return null;
  }

  const seconds = Number(tx.blockTimestamp);

  return {
    blockHeight: BigInt(tx.blockHeight),
    error: tx.err || null,
    fee: BigInt(tx.gasSpent ?? 0) * BigInt(tx.tx?.gasPrice ?? 0),
    timestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
  };
}
