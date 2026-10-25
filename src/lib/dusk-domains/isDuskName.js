/**
 * Tells whether a recipient is a `.dusk` name rather than an address.
 * Base58 addresses never contain a dot, so an address is never taken for a name.
 *
 * @param {string} input
 * @returns {boolean}
 */
const isDuskName = (input) => /\.dusk$/i.test(input.trim());

export default isDuskName;
