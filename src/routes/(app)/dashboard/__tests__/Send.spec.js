import {
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import "jsdom-worker";

import mockedWalletStore from "../../__mocks__/mockedWalletStore";
import { logo } from "$lib/dusk/icons";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import { transactions } from "$lib/mock-data";
import { walletStore } from "$lib/stores";

import Send from "../Contract/Operations/Send.svelte";

vi.mock("$lib/stores", async importOriginal => {
	/** @type {import("$lib/stores/stores").WalletStore} */
	const original = await importOriginal();

	return {
		...original,
		walletStore: {
			...mockedWalletStore,
			getTransactionsHistory: () => Promise.resolve(transactions),
			transfer: () => Promise.resolve(void 0)
		}
	};
});

describe("Send", () => {
	const statuses = [
		{
			key: {
				icon: {
					path: logo
				},
				label: "Spendable tokens"
			},
			value: {
				icon: {
					label: "DUSK",
					path: logo
				},
				value: 50000
			}
		}
	];

	const props = { statuses };
	const address =
		"Y05MCvisx3hIhGq50gQ7rZRmQKiIO03ly8DsVqKmU5cmIO1B7CKXPH2dtSC5sk6vmXJZ27qSMPfFsW";

	afterEach(cleanup);

	afterAll(() => {
		vi.doUnmock("$lib/stores");
	});

	it("renders the Send component Amount step", () => {
		const { container } = render(Send, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("sets the amount to max on click and checks if next button is enabled", async () => {
		const { getByRole } = render(Send, props);

		const component = getByRole("button", { name: "USE MAX" });

		await fireEvent.click(component);

		const input = getByRole("spinbutton");

		expect(input).toHaveValue(mockedWalletStore.getMockedStoreValue().balance.maximum);

		const next = getByRole("button", { name: "Next" });

		expect(next).toBeEnabled();
	});

	it("sets amount to zero and checks next if buton is disabled", async () => {
		const { getByRole } = render(Send, props);

		const input = getByRole("spinbutton");

		await fireEvent.input(input, { target: { value: 0 } });

		expect(input).toHaveValue(0);

		const next = getByRole("button", { name: "Next" });

		expect(next).toBeDisabled();
	});

	it("renders the Send component Address step", async () => {
		const { container, getByRole } = render(Send, props);

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("checks input for address value and next button if disabled", async () => {
		const { getByRole } = render(Send, props);

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		const input = getByRole("textbox");

		expect(input).toHaveValue("");
	});

	it("checks input for address value and next button if enabled", async () => {
		const { getByRole } = render(Send, props);

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		const input = getByRole("textbox");

		await fireEvent.input(input, { target: { value: address } });

		expect(input).toHaveValue(address);

		expect(next).toBeEnabled();
	});

	it("renders the Send component Review step", async () => {
		const { container, getByRole } = render(Send, props);

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		const next1 = getByRole("button", { name: "Next" });

		await fireEvent.click(next1);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("checks the displayed amount and address", async () => {
		const { container, getByRole } = render(Send, props);

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		const input = getByRole("textbox");

		await fireEvent.input(input, { target: { value: address } });

		const next1 = getByRole("button", { name: "Next" });

		await fireEvent.click(next1);

		const value = getAsHTMLElement(container, ".operation__review-amount span");

		expect(value.textContent).toBe("1.000000000");

		const key = getAsHTMLElement(container, ".operation__review-address span");

		expect(key.textContent).toBe(address);
	});

	describe("Send operation", () => {
		vi.useFakeTimers();

		const amount = 567;
		const mostRecentHash = transactions.slice().sort((a, b) => b.block_height - a.block_height)[0].id;
		const expectdExplorerLink = `https://explorer.dusk.network/transactions/transaction?id=${mostRecentHash}`;

		const transactionHistorySpy = vi.spyOn(walletStore, "getTransactionsHistory");
		const transferSpy = vi.spyOn(walletStore, "transfer");

		afterEach(() => {
			transactionHistorySpy.mockClear();
			transferSpy.mockClear();
		});

		afterAll(() => {
			transactionHistorySpy.mockRestore();
			transferSpy.mockRestore();
			vi.useRealTimers();
		});

		it("should perform a transfer for the desired amount, give a success message and supply a link to see the transaction in the explorer", async () => {
			const { getByRole, getByText } = render(Send, props);
			const amountInput = getByRole("spinbutton");

			await fireEvent.input(amountInput, { target: { value: amount } });
			await fireEvent.click(getByRole("button", { name: "Next" }));

			const input = getByRole("textbox");

			await fireEvent.input(input, { target: { value: address } });
			await fireEvent.click(getByRole("button", { name: "Next" }));
			await fireEvent.click(getByRole("button", { name: "SEND" }));

			await vi.advanceTimersToNextTimerAsync();

			expect(transferSpy).toHaveBeenCalledTimes(1);
			expect(transferSpy).toHaveBeenCalledWith(address, amount);
			expect(transactionHistorySpy).toHaveBeenCalledTimes(1);

			const explorerLink = getByRole("link", { name: /explorer/i });

			expect(getByText("Transaction completed")).toBeInTheDocument();
			expect(explorerLink).toHaveAttribute("target", "_blank");
			expect(explorerLink).toHaveAttribute("href", expectdExplorerLink);
		});

		it("should show an error message if the transfer fails", async () => {
			const errorMessage = "Some error message";

			transferSpy.mockRejectedValueOnce(new Error(errorMessage));

			const { getByRole, getByText } = render(Send, props);
			const amountInput = getByRole("spinbutton");

			await fireEvent.input(amountInput, { target: { value: amount } });
			await fireEvent.click(getByRole("button", { name: "Next" }));

			const input = getByRole("textbox");

			await fireEvent.input(input, { target: { value: address } });
			await fireEvent.click(getByRole("button", { name: "Next" }));
			await fireEvent.click(getByRole("button", { name: "SEND" }));

			await vi.advanceTimersToNextTimerAsync();

			expect(transferSpy).toHaveBeenCalledTimes(1);
			expect(transferSpy).toHaveBeenCalledWith(address, amount);
			expect(transactionHistorySpy).not.toHaveBeenCalled();
			expect(getByText("Transaction failed")).toBeInTheDocument();
			expect(getByText(errorMessage)).toBeInTheDocument();
		});

		it("should show the success message, but no explorer link, if the transfer suceeds but the retrieving the transaction history fails", async () => {
			transactionHistorySpy.mockRejectedValueOnce(new Error("some error"));

			const { getByRole, getByText } = render(Send, props);
			const amountInput = getByRole("spinbutton");

			await fireEvent.input(amountInput, { target: { value: amount } });
			await fireEvent.click(getByRole("button", { name: "Next" }));

			const input = getByRole("textbox");

			await fireEvent.input(input, { target: { value: address } });
			await fireEvent.click(getByRole("button", { name: "Next" }));
			await fireEvent.click(getByRole("button", { name: "SEND" }));

			await vi.advanceTimersToNextTimerAsync();

			expect(transferSpy).toHaveBeenCalledTimes(1);
			expect(transferSpy).toHaveBeenCalledWith(address, amount);
			expect(transactionHistorySpy).toHaveBeenCalledTimes(1);
			expect(getByText("Transaction completed")).toBeInTheDocument();
			expect(() => getByRole("link", { name: /explorer/i })).toThrow();
		});
	});
});
