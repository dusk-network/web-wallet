import { generateRandomMnemonic } from "@dusk-network/dusk-wallet-js";

import { getWasmExports } from "$lib/services/wasm";

/** @type {() => Promise<string>} */
const generateMnemonic = () => getWasmExports().then(generateRandomMnemonic);

export default generateMnemonic;
