import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Dashboard from "../+page.svelte";

describe("Dashboard", () => {
	afterEach(cleanup);

	it("should render the dashboard page", () => {
		const { container } = render(
			Dashboard,
			{
				props: {
					data: {
						currentPrice: { usd: 0.5 },
						dusk: 2000000
					}
				}
			}
		);

		expect(container.firstChild).toMatchSnapshot();
	});
});
