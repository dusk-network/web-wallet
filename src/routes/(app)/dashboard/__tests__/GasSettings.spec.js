import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import GasSettings from "../Contract/Operations/GasSettings/GasSettings.svelte";

describe("GasSettings", () => {
	afterEach(cleanup);
	it("renders the GasSettings component closed", () => {
		const { container } = render(GasSettings);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("renders the GasSettings component opened", async () => {
		const { container, getByRole } = render(GasSettings);

		const next = getByRole("button", { name: "EDIT" });

		await fireEvent.click(next);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("checks setGasSettings event is dispatched on click with the corect event data", async () => {
		const { component, getByRole, getAllByRole } = render(GasSettings);
		const edit = getByRole("button", { name: "EDIT" });

		await fireEvent.click(edit);

		const changeHandler = vi.fn();

		const gas = getAllByRole("spinbutton");
		const minGas = gas[0];
		const maxGas = gas[1];

		component.$on("setGasSettings", changeHandler);

		await fireEvent.input(minGas, { target: { value: 50000 } });
		await fireEvent.input(maxGas, { target: { value: 50000 } });

		const save = getByRole("button", { name: "SAVE" });

		await fireEvent.click(save);

		expect(changeHandler).toHaveBeenCalledTimes(1);
		expect(changeHandler).toHaveBeenCalledWith(
			new CustomEvent("setGasSettings", { detail: { minimum: 50000, maximum: 50000 } })
		);
	});
});
