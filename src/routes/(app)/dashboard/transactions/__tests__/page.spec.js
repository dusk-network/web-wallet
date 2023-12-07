import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Transactions from "../+page.svelte";

describe("Dashboard", () => {
	afterEach(cleanup);

	const keys = ["2087290d3dc213d43e493f03f5435f99",
		"ffbee869aca5ff5ee13c2706e5d9779d",
		"06527a34e1c91fc5785ea7764a0c34b1",
		"f62d307103ca54516b29fcedd5463d16"];
	const currentKey = keys[0];

	it("should render the transactions page", () => {
		const { container } = render(
			Transactions,
			{
				props: {
					data: {
						currentKey,
						currentPrice: { usd: 0.5 },
						keys
					}
				}
			}
		);

		expect(container.firstChild).toMatchSnapshot();
	});
});
