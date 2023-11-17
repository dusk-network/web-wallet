import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { renderWithSimpleContent } from "$lib/dusk/test-helpers";
import Layout from "../+layout.svelte";

describe("Dashboard Layout", () => {
	afterEach(cleanup);

	it("should render the dashboard layout", () => {
		const { container } = renderWithSimpleContent(Layout, {});

		expect(container.firstChild).toMatchSnapshot();
	});
});
