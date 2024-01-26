import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { AddressPicker } from "..";

global.ResizeObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn()
}));

describe("AddressPicker", () => {
	const addresses = ["2087290d3dc213d43e493f03f5435f99",
		"ffbee869aca5ff5ee13c2706e5d9779d",
		"06527a34e1c91fc5785ea7764a0c34b1",
		"f62d307103ca54516b29fcedd5463d16"];

	const currentAddress = addresses[0];

	const props = { currentAddress, addresses };

	beforeEach(() => {
		Object.assign(navigator, {
			clipboard: {
				writeText: vi.fn().mockResolvedValue(undefined)
			}
		});
	});

	afterEach(cleanup);

	it("renders the AddressPicker component", () => {
		const { container } = render(AddressPicker, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("copies the current address on Copy button click", async () => {
		const { getByRole } = render(AddressPicker, props);

		const component = getByRole("button", { name: "Copy Address" });

		await fireEvent.click(component);

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(currentAddress);
	});
});
