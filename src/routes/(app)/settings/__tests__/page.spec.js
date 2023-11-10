import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Settings from "../+page.svelte";

describe("Settings", () => {
	afterEach(cleanup);

	it("should render the settings page", () => {
		const { container } = render(Settings, {});

		expect(container.firstChild).toMatchSnapshot();
	});
});
