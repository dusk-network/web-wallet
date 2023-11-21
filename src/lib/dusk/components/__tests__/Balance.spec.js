import {
	afterEach,
	describe,
	expect,
	it
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { Balance } from "..";

describe("Balance", () => {
	const baseProps = { dusk: 2000000, fiat: 100000, currency: "EUR" };
	const baseOptions = {
		props: baseProps
	};

	afterEach(cleanup);

	it("renders the Balance component", () => {
		const { container } = render(Balance, baseOptions);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should update the Balance component when the props change", () => {
		const { container, rerender } = render(Balance, baseOptions);

		expect(container.firstChild).toMatchSnapshot();

		rerender({ dusk: 4000000, fiat: 200000, currency: "USD" });

		expect(container.firstChild).toMatchSnapshot();
	});
});
