import { gasStore } from "$lib/stores";
import { get } from "svelte/store";

/**
 *
 * @param {bigint} price
 * @param {bigint} limit
 * @param {GasStoreContent} [bounds] The operation's bounds, see `getGasLimits`; the global ones by default.
 * @returns {Boolean}
 */
const areValidGasSettings = (price, limit, bounds = get(gasStore)) => {
  let isValidPrice = false;
  let isValidLimit = false;
  let isGasValid = false;

  if ([price, limit].every((value) => typeof value === "bigint")) {
    isValidPrice = price >= bounds.gasPriceLower && price <= limit;
    isValidLimit =
      limit >= bounds.gasLimitLower && limit <= bounds.gasLimitUpper;
    isGasValid = isValidPrice && isValidLimit;
  }

  return isGasValid;
};

export default areValidGasSettings;
