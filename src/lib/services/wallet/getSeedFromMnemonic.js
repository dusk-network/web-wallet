import { getSeedFromMnemonic as getSeed } from "@dusk-network/dusk-wallet-js";

import { getWasmExports } from "$lib/services/wasm";

/**
 * The current version of the library states to be returning a string,
 * but returns instead a `Number[]`.
 * The Wallet constructor wants a `Uint8Array` instead as seed.
 * @see {@link https://github.com/dusk-network/dusk-wallet-js/issues/9}
 * @param {WebAssembly.Exports} exports
 * @param {String} mnemonic
 * @param {String} password
 * @returns {Uint8Array}
 */
function getFixedSeed (exports, mnemonic, password) {
	/** @type {unknown} necessary to cast to `Number[]` afterwards */
	const seed = getSeed(exports, mnemonic, password);

	// eslint-disable-next-line no-extra-parens
	return Uint8Array.from(/** @type {Number[]} */ (seed));
}

/**
 * @param {String} mnemonic
 * @param {String} password
 * @returns {Promise<Uint8Array>}
 */
const getSeedFromMnemonic = (mnemonic, password) => getWasmExports()
	.then(exports => getFixedSeed(exports, mnemonic, password));

export default getSeedFromMnemonic;
