import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Transactions from "../+page.svelte";

describe("Dashboard", () => {
	afterEach(cleanup);

	it("should render the transactions page", () => {
		const { container } = render(
			Transactions,
			{
				props: {
					data: {
						currentPrice: { usd: 0.5 }
					}
				}
			}
		);

		expect(container.firstChild).toMatchSnapshot();
	});
});
