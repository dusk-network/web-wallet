import { afterEach, describe, expect, it, vitest } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import KeyPicker from "../KeyPicker.svelte";

describe("KeyPicker", () => {
	const keys = ["2087290d3dc213d43e493f03f5435f99",
		"ffbee869aca5ff5ee13c2706e5d9779d",
		"06527a34e1c91fc5785ea7764a0c34b1",
		"f62d307103ca54516b29fcedd5463d16"];

	const currentKey = keys[0];

	const props = { currentKey, keys };

	afterEach(cleanup);

	it("renders the KeyPicker component", () => {
		const { container } = render(KeyPicker, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("toggles dropdown on click", async () => {
		const { getByRole, queryByText } = render(KeyPicker, props);

		const component = getByRole("button");

		await fireEvent.click(component);
		expect(queryByText(keys[1])).toBeInTheDocument();
		await fireEvent.click(component);
		expect(queryByText(keys[1])).not.toBeInTheDocument();
	});

	it("updates selected key on click", async () => {
		const { getByRole, getByText } = render(KeyPicker, props);
		const componentTrigger = getByRole("button");

		await fireEvent.click(componentTrigger);

		const secondKeyOption = getByText(keys[1]);

		await fireEvent.click(secondKeyOption);
		expect(getByText(keys[1])).toBeInTheDocument();
	});

	it("dispatches generateKey event on button click", async () => {
		const { getByRole, getByText, component } = render(KeyPicker, props);
		const spy = vitest.fn();

		const componentTrigger = getByRole("button");

		await fireEvent.click(componentTrigger);

		component.$on("generateKey", spy);

		const generateKeyButton = getByText("Generate Key");

		await fireEvent.click(generateKeyButton);
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
