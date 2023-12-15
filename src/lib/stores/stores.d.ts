import type { Readable } from "svelte/store";
import type { Wallet } from "@dusk-network/dusk-wallet-js";

type TransactionsStoreContent = { transactions: Transaction[] };

type TransactionsStore = Readable<TransactionsStoreContent>;

type WalletStoreContent = {
	balance: {
		maximum: number;
		value: number;
	};
	currentKey: string;
	error: Error | null;
	initialized: boolean;
	keys: string[];
	isSyncing: boolean;
};

type WalletStoreServices = {
	getStakeInfo: () => Promise<ReturnType<Wallet["stakeInfo"]>>;

	getTransactionsHistory: () => Promise<ReturnType<Wallet["history"]>>;

	init: (wallet: Wallet) => Promise<void>;

	reset: () => void;

	setCurrentKey: (key: string) => Promise<void>;

	stake: (amount: number) => Promise<ReturnType<Wallet["stake"]>>;

	sync: () => Promise<void>;

	transfer: (to: string, amount: number) => Promise<ReturnType<Wallet["transfer"]>>;

	unstake: () => Promise<ReturnType<Wallet["unstake"]>>;

	withdrawReward: () => Promise<ReturnType<Wallet["withdrawReward"]>>;
};

type WalletStore = Readable<WalletStoreContent> & WalletStoreServices;
