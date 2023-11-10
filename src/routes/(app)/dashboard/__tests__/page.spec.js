import { afterAll, afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Dashboard from "../+page.svelte";

describe("Dashboard", () => {
	const originalResizeObserver = global.ResizeObserver;

	global.ResizeObserver = ResizeObserver;

	afterEach(cleanup);

	afterAll(() => {
		global.ResizeObserver = originalResizeObserver;
	});

	it("should render the dashboard page", () => {
		const { container } = render(Dashboard, {});

		expect(container.firstChild).toMatchSnapshot();
	});
});
