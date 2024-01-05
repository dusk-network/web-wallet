import {
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import GasSettings from "../GasSettings/GasSettings.svelte";

describe("GasSettings", () => {
	const baseProps = {
		limit: 20000000,
		limitLower: 10000000,
		limitUpper: 1000000000,
		locale: "it",
		price: 1,
		priceLower: 1
	};

	const baseOptions = {
		props: baseProps,
		target: document.body
	};

	afterEach(cleanup);

	it("renders the GasSettings component closed", () => {
		const { container } = render(GasSettings, baseOptions);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("renders the GasSettings component opened", async () => {
		const { container, getByRole } = render(GasSettings, baseOptions);

		const next = getByRole("button", { name: "EDIT" });

		await fireEvent.click(next);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("checks setGasSettings event is dispatched on click with the correct event data", async () => {
		const eventHandler = vi.fn();
		const { component, getByRole, getAllByRole } = render(GasSettings, baseOptions);
		const editButton = getByRole("button", { name: "EDIT" });

		expect(() => getAllByRole("spinbutton")).toThrow();

		await fireEvent.click(editButton);

		component.$on("setGasSettings", eventHandler);

		const [priceInput, limitInput] = getAllByRole("spinbutton");

		await fireEvent.input(limitInput, { target: { value: baseProps.limitLower } });

		expect(eventHandler).toHaveBeenCalledTimes(1);
		expect(eventHandler.mock.lastCall[0].detail).toStrictEqual({
			limit: baseProps.limitLower,
			price: baseProps.price
		});

		await fireEvent.input(priceInput, { target: { value: baseProps.price * 2 } });

		expect(eventHandler).toHaveBeenCalledTimes(2);
		expect(eventHandler.mock.lastCall[0].detail).toStrictEqual({
			limit: baseProps.limitLower,
			price: baseProps.price * 2
		});
	});
});
