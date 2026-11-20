/**
 * How many times the network's gas price a fee's gas price is, where that's
 * high: from twice the network's price, as the Dusk Wallet extension warns of
 * a fee a site chose. To one decimal, rounded down, as the extension says it;
 * null under twice, or while the network's price isn't known.
 *
 * @param {bigint} price The gas price the fee is set at, in lux.
 * @param {bigint | null | undefined} networkPrice The gas price the network
 *   asks now, in lux.
 * @returns {number | null}
 */
export function timesNetworkPrice(price, networkPrice) {
  if (!networkPrice || networkPrice <= 0n || price < networkPrice * 2n) {
    return null;
  }

  return Number((price * 10n) / networkPrice) / 10;
}

/**
 * The gas price the network asks now, by the wallets' rule
 * (`@dusk-network/app-core/gas`): the default it gives, or, while the network
 * is busy, the median of what waits, which the busy note says to raise the
 * price to. Raising it as told is never said to be a high fee.
 *
 * @param {{ busy: boolean, median: bigint | null, price: bigint }} rule
 * @returns {bigint}
 */
export const networkPriceOf = ({ busy, median, price }) =>
  busy && median !== null && median > price ? median : price;

/**
 * The line a fee far above the network's price says, as the extension says
 * it: "High fee. It's 50 times the network's price.", in the language's
 * digits; "" for any other fee.
 *
 * @param {bigint} price The gas price the fee is set at, in lux.
 * @param {bigint | null | undefined} networkPrice The gas price the network
 *   asks now, in lux.
 * @param {string} [language]
 * @returns {string}
 */
export function highFeeText(price, networkPrice, language) {
  const times = timesNetworkPrice(price, networkPrice);

  return times === null
    ? ""
    : `High fee. It's ${times.toLocaleString(language || undefined, { maximumFractionDigits: 1 })} times the network's price.`;
}
