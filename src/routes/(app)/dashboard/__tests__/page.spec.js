import {
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

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

	it("should render the dashboard page only with the Receive button while syncing", () => {
		mockedWalletStore.getMockedStoreValue().isSyncing = true;

		const { container } = render(Dashboard, { data: { currentPrice } });

		expect(container.querySelector(".dashboard-content__receive")).toBeTruthy();
		expect(container.firstChild).toMatchSnapshot();
	});

	it("should render the dashboard page only with the Receive button while syncing error", () => {
		mockedWalletStore.getMockedStoreValue().isSyncing = false;
		mockedWalletStore.getMockedStoreValue().error = new Error();

		const { container } = render(Dashboard, { data: { currentPrice } });

		expect(container.querySelector(".dashboard-content__receive")).toBeTruthy();
		expect(container.firstChild).toMatchSnapshot();
	});

	it("should show the qr code on click", async () => {
		mockedWalletStore.getMockedStoreValue().isSyncing = true;
		mockedWalletStore.getMockedStoreValue().error = null;

		const { getByRole, container } = render(Dashboard, { data: { currentPrice } });

		const receive = getByRole("button", { name: "receive" });

		await fireEvent.click(receive);

		expect(container.querySelector(".receive")).toBeTruthy();

		await fireEvent.click(receive);

		expect(container.querySelector(".receive")).not.toBeTruthy();
	});
});
