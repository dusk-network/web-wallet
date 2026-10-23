import middleEllipsis from "./middleEllipsis";

/**
 * Shortens an address for display to its first and last six characters
 * around an ellipsis, as in `2in5nc…fMMLNz`. An address of twelve
 * characters or fewer is returned as it is.
 *
 * @param {string} address
 * @returns {string}
 */
function shortenAddress(address) {
  return middleEllipsis(address, 6, "…");
}

export default shortenAddress;
