import { get, writable } from "svelte/store";
import { getKey, uniquesBy } from "lamb";

import settingsStore from "./settingsStore";

/**
 * @typedef {import("@dusk-network/dusk-wallet-js").Wallet} Wallet
 */

/**
 * @typedef {import("./stores").WalletStoreServices["getTransactionsHistory"]} GetTransactionsHistory
 */

/** @type {Promise<void> | null} */
let syncPromise = null;

/** @type {Wallet | null} */
let walletInstance = null;

const uniquesById = uniquesBy(getKey("id"));

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

/* eslint-disable-next-line svelte/require-store-callbacks-use-set-param */
const walletStore = writable(initialState, () => settingsStore.subscribe(({
	gasLimit,
	gasPrice
}) => {
	if (walletInstance) {
		walletInstance.gasLimit = gasLimit;
		walletInstance.gasPrice = gasPrice;
	}
}));
const { set, subscribe } = walletStore;
const getCurrentKey = () => get(walletStore).currentKey;

/** @type {(action: (...args: any[]) => Promise<any>) => Promise<void>} */
const syncedAction = action => sync().then(action).finally(sync);

/** @type {() => Promise<void>} */
const clearLocalData = async () => walletInstance?.reset();

/** @type {(wallet: Wallet) => Promise<void>} */
const clearLocalDataAndInit = wallet => wallet.reset().then(() => init(wallet));

/** @type {import("./stores").WalletStoreServices["getStakeInfo"]} */
// @ts-expect-error
const getStakeInfo = async () => sync().then(() => walletInstance.stakeInfo(getCurrentKey()));

/** @type {GetTransactionsHistory} */

// @ts-expect-error
const getTransactionsHistory = async () => sync().then(() => walletInstance.history(getCurrentKey()))
	.then(uniquesById);

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

	const keys = await walletInstance.getPsks();
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
function sync () {
	if (!walletInstance) {
		throw new Error("No wallet instance to sync");
	}

	if (!syncPromise) {
		const store = get(walletStore);

		set({ ...store, error: null, isSyncing: true });

		syncPromise = walletInstance.sync().then(
			updateAfterSync,
			error => { set({ ...store, error, isSyncing: false }); }
		).finally(() => { syncPromise = null; });
	}

	return syncPromise;
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
	clearLocalData,
	clearLocalDataAndInit,
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
