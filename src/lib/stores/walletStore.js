import { get, writable } from "svelte/store";

/**
 * @typedef {import("@dusk-network/dusk-wallet-js").Wallet} Wallet
 */

/**
 * @typedef {Object} WalletStoreData
 * @property {Error?} error
 * @property {Boolean} isSyncing
 * @property {Wallet?} wallet
 */

/** @type {WalletStoreData} */
const initialState = {
	error: null,
	isSyncing: false,
	wallet: null
};

const walletStore = writable(initialState);
const { set, subscribe } = walletStore;

/** @param {Wallet} wallet */
function init (wallet) {
	set({ ...get(walletStore), wallet });
	sync();
}

/** @type {() => Promise<void>} */
async function sync () {
	const store = get(walletStore);

	if (!store.wallet) {
		throw new Error("No wallet instance to sync");
	}

	set({ ...store, error: null, isSyncing: true });

	return store.wallet.sync().then(
		() => { set({ ...store, isSyncing: false }); },
		error => { set({ ...store, error, isSyncing: false }); }
	);
}

/**
 * @type {import("svelte/store").Readable<WalletStoreData> & {
 *     init: (wallet: Wallet) => void, sync: () => Promise<void>
 * }}
 */
export default {
	init,
	subscribe,
	sync
};
