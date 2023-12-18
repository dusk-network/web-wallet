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

import { logo } from "$lib/dusk/icons";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";

import mockedWalletStore from "../__mocks__/mockedWalletStore";
import Send from "../Contract/Operations/Send.svelte";

vi.mock("$lib/stores", async importOriginal => {
	/** @type {import("$lib/stores/stores").WalletStore} */
	const original = await importOriginal();

	return {
		...original,
		walletStore: mockedWalletStore
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

		expect(value.textContent).toBe("1.00");

		const key = getAsHTMLElement(container, ".operation__review-address span");

		expect(key.textContent).toBe(address);
	});
});
