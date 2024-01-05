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
		const { component, getByRole, getAllByRole } = render(GasSettings, baseOptions);
		const edit = getByRole("button", { name: "EDIT" });

		await fireEvent.click(edit);

		const changeHandler = vi.fn();

		const gas = getAllByRole("spinbutton");
		const minGas = gas[0];
		const maxGas = gas[1];

		component.$on("setGasSettings", changeHandler);

		await fireEvent.input(minGas, { target: { value: 50000 } });

		expect(changeHandler).toHaveBeenCalledTimes(1);
		expect(changeHandler).toHaveBeenCalledWith(
			new CustomEvent("setGasSettings", { detail: { minimum: 50000, maximum: maxGas } })
		);

		await fireEvent.input(maxGas, { target: { value: 50000 } });

		expect(changeHandler).toHaveBeenCalledTimes(2);
		expect(changeHandler).toHaveBeenCalledWith(
			new CustomEvent("setGasSettings", { detail: { minimum: 50000, maximum: 50000 } })
		);
	});
});
