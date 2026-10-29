import {
  formatContractId,
  formatEvmAddress,
  shortAccount,
} from "@dusk-network/networks/format";

/**
 * An ID shortened the one way the Dusk apps shorten them, with
 * `@dusk-network/networks/format`: a Dusk account, contract ID or hash to
 * its first and last six characters, as in `2in5nc…fMMLNz`, an EVM address
 * to 0x and four characters with its checksum, and the last four, as in
 * `0xAB84…C86F`, and an EVM transaction hash to 0x and four, and the last
 * four. What is too short to shorten stays as it is.
 *
 * @param {string} address
 * @returns {string}
 */
function shortenAddress(address) {
  const value = String(address ?? "").trim();

  if (/^0x[0-9a-f]{40}$/i.test(value)) {
    return formatEvmAddress(value, { short: true });
  }

  // As an EVM address is shortened, without a checksum: a hash has none.
  if (/^0x[0-9a-f]{64}$/i.test(value)) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`.toLowerCase();
  }

  if (/^[0-9a-f]{64}$/i.test(value)) {
    return formatContractId(value, { short: true });
  }

  return value ? shortAccount(value) : value;
}

export default shortenAddress;
