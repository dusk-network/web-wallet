import { mockReadableStore } from "$lib/dusk/test-helpers";

const balance = { maximum: 50000, value: 2345 };
const keys = [
	"2087290d3dc213d43e493f03f5435f99",
	"ffbee869aca5ff5ee13c2706e5d9779d",
	"06527a34e1c91fc5785ea7764a0c34b1",
	"f62d307103ca54516b29fcedd5463d16"
];
const currentKey = keys[0];

/** @type {import("$lib/stores/stores").WalletStoreContent} */
const content = {
	balance,
	currentKey,
	error: null,
	initialized: true,
	isSyncing: false,
	keys
};

export default mockReadableStore(content);
