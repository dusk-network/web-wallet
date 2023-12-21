import {
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import mockedWalletStore from "../__mocks__/mockedWalletStore";
import Dashboard from "../+page.svelte";

vi.mock("$lib/stores", async importOriginal => {
	/** @type {import("$lib/stores/stores").WalletStore} */
	const original = await importOriginal();

	return {
		...original,
		walletStore: mockedWalletStore
	};
});

describe("Dashboard", () => {
	afterEach(cleanup);

	afterAll(() => {
		vi.doUnmock("$lib/stores");
	});

	const currentPrice = { usd: 0.5 };

	it("should render the dashboard page", () => {
		const { container } = render(Dashboard, { data: { currentPrice } });

		expect(container.firstChild).toMatchSnapshot();
	});
});
