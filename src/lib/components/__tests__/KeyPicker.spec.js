import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { KeyPicker } from "..";

global.ResizeObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn()
}));

describe("KeyPicker", () => {
	const keys = ["2087290d3dc213d43e493f03f5435f99",
		"ffbee869aca5ff5ee13c2706e5d9779d",
		"06527a34e1c91fc5785ea7764a0c34b1",
		"f62d307103ca54516b29fcedd5463d16"];

	const currentKey = keys[0];

	const props = { currentKey, keys };

	beforeEach(() => {
		Object.assign(navigator, {
			clipboard: {
				writeText: vi.fn().mockResolvedValue(undefined)
			}
		});
	});

	afterEach(cleanup);

	it("renders the KeyPicker component", () => {
		const { container } = render(KeyPicker, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("copies the current key on Copy button click", async () => {
		const { getByRole } = render(KeyPicker, props);

		const component = getByRole("button", { name: "Copy Key" });

		await fireEvent.click(component);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(currentKey);
	});
});
