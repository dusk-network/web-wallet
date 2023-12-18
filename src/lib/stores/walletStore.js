import { get, writable } from "svelte/store";

/**
 * @typedef {import("@dusk-network/dusk-wallet-js").Wallet} Wallet
 */

/**
 * @typedef {import("./stores").WalletStoreServices["getTransactionsHistory"]} GetTransactionsHistory
 */

/** @type {Wallet | null} */
let walletInstance = null;

/** @type {import("./stores").WalletStoreContent} */
const initialState = {
	balance: {
		maximum: 0,
		value: 0
	},
	currentKey: "",
	error: null,
	initialized: false,
	isSyncing: false,
	keys: []
};

const walletStore = writable(initialState);
const { set, subscribe } = walletStore;
const getCurrentKey = () => get(walletStore).currentKey;

/** @type {(action: (...args: any[]) => Promise<any>) => Promise<void>} */
const syncedAction = action => sync().then(action).finally(sync);

/** @type {import("./stores").WalletStoreServices["getStakeInfo"]} */
// @ts-expect-error
const getStakeInfo = async () => sync().then(() => walletInstance.stakeInfo(getCurrentKey()));

/** @type {GetTransactionsHistory} */
// @ts-expect-error
const getTransactionsHistory = async () => sync().then(() => walletInstance.history(getCurrentKey()));

function reset () {
	walletInstance = null;
	set(initialState);
}

async function updateAfterSync () {
	const store = get(walletStore);

	// @ts-expect-error
	const balance = await walletInstance.getBalance(store.currentKey);

	set({
		...store,
		balance,
		isSyncing: false
	});
}

/** @param {Wallet} wallet */
async function init (wallet) {
	walletInstance = wallet;

	const keys = walletInstance.getPsks();
	const currentKey = keys[0];

	set({
		...initialState,
		currentKey,
		initialized: true,
		keys
	});
	sync();
}

/** @type {import("./stores").WalletStoreServices["setCurrentKey"]} */
async function setCurrentKey (key) {
	const store = get(walletStore);

	return store.keys.includes(key)
		? Promise.resolve(set({ ...store, currentKey: key })).then(sync)
		: Promise.reject(new Error("The received key is not in the list"));
}

/** @type {import("./stores").WalletStoreServices["stake"]} */
// @ts-expect-error
const stake = async amount => syncedAction(() => walletInstance.stake(getCurrentKey(), amount));

/** @type {import("./stores").WalletStoreServices["sync"]} */
async function sync () {
	if (!walletInstance) {
		throw new Error("No wallet instance to sync");
	}

	const store = get(walletStore);

	set({ ...store, error: null, isSyncing: true });

	return walletInstance.sync().then(
		updateAfterSync,
		error => { set({ ...store, error, isSyncing: false }); }
	);
}

/** @type {import("./stores").WalletStoreServices["transfer"]} */
// @ts-expect-error
const transfer = async (to, amount) => syncedAction(() => walletInstance.transfer(
	getCurrentKey(),
	to,
	amount
));

/** @type {import("./stores").WalletStoreServices["unstake"]} */
// @ts-expect-error
const unstake = async () => syncedAction(() => walletInstance.unstake(getCurrentKey()));

/** @type {import("./stores").WalletStoreServices["withdrawReward"]} */
// @ts-expect-error
const withdrawReward = async () => syncedAction(() => walletInstance.withdrawReward(getCurrentKey()));

/** @type {import("./stores").WalletStore} */
export default {
	getStakeInfo,
	getTransactionsHistory,
	init,
	reset,
	setCurrentKey,
	stake,
	subscribe,
	sync,
	transfer,
	unstake,
	withdrawReward
};
