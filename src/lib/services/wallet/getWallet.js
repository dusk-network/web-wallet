import { getWasmExports } from "$lib/services/wasm";

import { Wallet } from "@dusk-network/dusk-wallet-js";

/**
 * Gets a `Wallet` instance.
 * Currently the `dusk-wallet-js` library doesn't have
 * a type definition for the instance.
 * @see {@link https://github.com/dusk-network/dusk-wallet-js/issues/10}
 * @param {Uint8Array} seed
 * @param {Number} [gasLimit=2900000000]
 * @param {Number} [gasPrice=1]
 * @returns {Promise<Wallet>}
 */
const getWallet = (seed, gasLimit, gasPrice) => getWasmExports()
	.then(exports => new Wallet(exports, Array.from(seed), gasLimit, gasPrice));

export default getWallet;
