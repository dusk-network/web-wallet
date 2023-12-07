import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
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
});
