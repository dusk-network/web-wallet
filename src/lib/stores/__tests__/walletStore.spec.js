import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { get } from "svelte/store";

import { Wallet } from "@dusk-network/dusk-wallet-js";

import { walletStore } from "..";

vi.useFakeTimers();

describe("walletStore", async () => {
	const balance = { maximum: 100, value: 1 };
	const keys = [
		"2087290d3dc213d43e493f03f5435f99",
		"ffbee869aca5ff5ee13c2706e5d9779d",
		"06527a34e1c91fc5785ea7764a0c34b1",
		"f62d307103ca54516b29fcedd5463d16"
	];
	const wallet = new Wallet({}, []);

	const getBalanceSpy = vi.spyOn(Wallet.prototype, "getBalance").mockResolvedValue(balance);
	const getPsksSpy = vi.spyOn(Wallet.prototype, "getPsks").mockReturnValue(keys);
	const historySpy = vi.spyOn(Wallet.prototype, "history").mockResolvedValue([]);
	const stakeInfoSpy = vi.spyOn(Wallet.prototype, "stakeInfo").mockResolvedValue({});
	const stakeSpy = vi.spyOn(Wallet.prototype, "stake").mockResolvedValue(void 0);
	const syncSpy = vi.spyOn(Wallet.prototype, "sync").mockResolvedValue(void 0);
	const transferSpy = vi.spyOn(Wallet.prototype, "transfer").mockResolvedValue(void 0);
	const unstakeSpy = vi.spyOn(Wallet.prototype, "unstake").mockResolvedValue(void 0);
	const withdrawRewardSpy = vi.spyOn(Wallet.prototype, "withdrawReward").mockResolvedValue(void 0);

	afterEach(() => {
		getBalanceSpy.mockClear();
		getPsksSpy.mockClear();
		historySpy.mockClear();
		stakeInfoSpy.mockClear();
		stakeSpy.mockClear();
		syncSpy.mockClear();
		transferSpy.mockClear();
		unstakeSpy.mockClear();
		withdrawRewardSpy.mockClear();
	});

	afterAll(() => {
		getBalanceSpy.mockRestore();
		getPsksSpy.mockRestore();
		historySpy.mockRestore();
		stakeInfoSpy.mockRestore();
		stakeSpy.mockRestore();
		syncSpy.mockRestore();
		transferSpy.mockRestore();
		unstakeSpy.mockRestore();
		withdrawRewardSpy.mockRestore();
	});

	describe("Initialization and sync", () => {
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
		const initializedStore = {
			...initialState,
			balance,
			currentKey: keys[0],
			initialized: true,
			keys
		};

		it("should expose a `reset` method to bring back the store to its initial state", async () => {
			await walletStore.init(wallet);
			await vi.advanceTimersToNextTimerAsync();

			expect(get(walletStore)).toStrictEqual(initializedStore);

			walletStore.reset();

			expect(get(walletStore)).toStrictEqual(initialState);
		});

		it("should expose a method to initialize the store with a Wallet instance", async () => {
			await walletStore.init(wallet);

			expect(get(walletStore)).toStrictEqual({
				...initialState,
				currentKey: keys[0],
				error: null,
				initialized: true,
				isSyncing: true,
				keys
			});
			expect(getPsksSpy).toHaveBeenCalledTimes(1);
			expect(getBalanceSpy).not.toHaveBeenCalled();

			await vi.advanceTimersToNextTimerAsync();

			expect(syncSpy).toHaveBeenCalledTimes(1);
			expect(getBalanceSpy).toHaveBeenCalledTimes(1);
			expect(getBalanceSpy).toHaveBeenCalledWith(keys[0]);
			expect(get(walletStore)).toStrictEqual(initializedStore);
		});

		it("should set the sync error in the store if the sync fails", async () => {
			walletStore.reset();

			const storewWhileLoading = {
				...initialState,
				currentKey: keys[0],
				error: null,
				initialized: true,
				isSyncing: true,
				keys
			};
			const error = new Error("sync failed");

			syncSpy.mockRejectedValueOnce(error);

			await walletStore.init(wallet);

			expect(get(walletStore)).toStrictEqual(storewWhileLoading);
			expect(getPsksSpy).toHaveBeenCalledTimes(1);
			expect(getBalanceSpy).not.toHaveBeenCalled();

			await vi.advanceTimersToNextTimerAsync();

			expect(syncSpy).toHaveBeenCalledTimes(1);
			expect(getBalanceSpy).not.toHaveBeenCalled();
			expect(get(walletStore)).toStrictEqual({
				...storewWhileLoading,
				error,
				isSyncing: false
			});

			walletStore.reset();
		});

		it("should throw an error when the syncronization is called without initializing the store first", async () => {
			walletStore.reset();

			expect(walletStore.sync).rejects.toThrow();
		});
	});

	describe("Wallet store services", () => {
		const currentKey = keys[0];

		afterEach(() => {
			walletStore.reset();
		});

		beforeEach(async () => {
			await walletStore.init(wallet);
			await vi.advanceTimersToNextTimerAsync();

			syncSpy.mockClear();
		});

		it("should expose a method to retrieve the stake info", async () => {
			await walletStore.getStakeInfo();

			expect(syncSpy).toHaveBeenCalledTimes(1);
			expect(stakeInfoSpy).toHaveBeenCalledTimes(1);
			expect(stakeInfoSpy).toHaveBeenCalledWith(currentKey);
			expect(syncSpy.mock.invocationCallOrder[0])
				.toBeLessThan(stakeInfoSpy.mock.invocationCallOrder[0]);
		});

		it("should expose a method to retrieve the transaction history", async () => {
			await walletStore.getTransactionsHistory();

			expect(syncSpy).toHaveBeenCalledTimes(1);
			expect(historySpy).toHaveBeenCalledTimes(1);
			expect(historySpy).toHaveBeenCalledWith(currentKey);
			expect(syncSpy.mock.invocationCallOrder[0])
				.toBeLessThan(historySpy.mock.invocationCallOrder[0]);
		});

		it("should expose a method to set the current key", async () => {
			const setCurrentKeySpy = vi.spyOn(walletStore, "setCurrentKey");

			await walletStore.setCurrentKey(keys[1]);

			expect(syncSpy).toHaveBeenCalledTimes(1);
			expect(get(walletStore).currentKey).toBe(keys[1]);
			expect(setCurrentKeySpy.mock.invocationCallOrder[0])
				.toBeLessThan(syncSpy.mock.invocationCallOrder[0]);

			setCurrentKeySpy.mockRestore();
		});

		it("should return a rejected promise if the new key is not in the list", () => {
			expect(walletStore.setCurrentKey("foo bar")).rejects.toThrow();

			expect(syncSpy).not.toHaveBeenCalled();
			expect(get(walletStore).currentKey).toBe(currentKey);
		});

		it("should expose a method to allow to stake an amount of Dusk", async () => {
			await walletStore.stake(10);

			expect(syncSpy).toHaveBeenCalledTimes(2);
			expect(stakeSpy).toHaveBeenCalledTimes(1);
			expect(stakeSpy).toHaveBeenCalledWith(currentKey, 10);
			expect(syncSpy.mock.invocationCallOrder[0])
				.toBeLessThan(stakeSpy.mock.invocationCallOrder[0]);
			expect(syncSpy.mock.invocationCallOrder[1])
				.toBeGreaterThan(stakeSpy.mock.invocationCallOrder[0]);
		});

		it("should expose a method to allow to transfer an amount of Dusk", async () => {
			await walletStore.transfer(keys[1], 10);

			expect(syncSpy).toHaveBeenCalledTimes(2);
			expect(transferSpy).toHaveBeenCalledTimes(1);
			expect(transferSpy).toHaveBeenCalledWith(currentKey, keys[1], 10);
			expect(syncSpy.mock.invocationCallOrder[0])
				.toBeLessThan(transferSpy.mock.invocationCallOrder[0]);
			expect(syncSpy.mock.invocationCallOrder[1])
				.toBeGreaterThan(transferSpy.mock.invocationCallOrder[0]);
		});

		it("should expose a method to allow to unstake the current key", async () => {
			await walletStore.unstake();

			expect(syncSpy).toHaveBeenCalledTimes(2);
			expect(unstakeSpy).toHaveBeenCalledTimes(1);
			expect(unstakeSpy).toHaveBeenCalledWith(currentKey);
			expect(syncSpy.mock.invocationCallOrder[0])
				.toBeLessThan(unstakeSpy.mock.invocationCallOrder[0]);
			expect(syncSpy.mock.invocationCallOrder[1])
				.toBeGreaterThan(unstakeSpy.mock.invocationCallOrder[0]);
		});

		it("should expose a method to allow to withdraw a reward", async () => {
			await walletStore.withdrawReward();

			expect(syncSpy).toHaveBeenCalledTimes(2);
			expect(withdrawRewardSpy).toHaveBeenCalledTimes(1);
			expect(withdrawRewardSpy).toHaveBeenCalledWith(currentKey);
			expect(syncSpy.mock.invocationCallOrder[0])
				.toBeLessThan(withdrawRewardSpy.mock.invocationCallOrder[0]);
			expect(syncSpy.mock.invocationCallOrder[1])
				.toBeGreaterThan(withdrawRewardSpy.mock.invocationCallOrder[0]);
		});
	});
});
