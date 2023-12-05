import { getKey } from "lamb";

// eslint-disable-next-line import/no-unresolved
import init from "@dusk-network/dusk-wallet-core/dusk_wallet_core_bg.wasm?init";

const imports = {
	env: {
		panic: () => {}
	}
};

/** @type {Promise<WebAssembly.Exports>} */
let wasmExports;

/** @type {() => Promise<WebAssembly.Exports>} */
function getWasmExports () {
	if (!wasmExports) {
		wasmExports = init(imports).then(getKey("exports"));
	}

	return wasmExports;
}

export default getWasmExports;
