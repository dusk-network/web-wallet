import {
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup } from "@testing-library/svelte";
import { renderWithSimpleContent } from "$lib/dusk/test-helpers";
import mockedWalletStore from "../__mocks__/mockedWalletStore";
import Layout from "../+layout.svelte";

vi.mock("$lib/stores", async importOriginal => {
	/** @type {import("$lib/stores/stores").WalletStore} */
	const original = await importOriginal();

	return {
		...original,
		walletStore: mockedWalletStore
	};
});

describe("Dashboard Layout", () => {
	afterEach(cleanup);

	afterAll(() => {
		vi.doUnmock("$lib/stores");
	});

	it("should render the dashboard layout", () => {
		const { container } = renderWithSimpleContent(Layout, {});

		expect(container.querySelector(".footer__icon-wrapper--success")).toBeTruthy();
		expect(container.firstChild).toMatchSnapshot();
	});

	it("should render the dashboard layout in the sync state", () => {
		mockedWalletStore.getMockedStoreValue().isSyncing = true;

		const { container } = renderWithSimpleContent(Layout, {});

		expect(container.querySelector(".footer__icon-wrapper--sync")).toBeTruthy();
		expect(container.firstChild).toMatchSnapshot();
	});

	it("should render the dashboard layout in the error state", () => {
		mockedWalletStore.getMockedStoreValue().isSyncing = false;
		mockedWalletStore.getMockedStoreValue().error = new Error();

		const { container } = renderWithSimpleContent(Layout, {});

		expect(container.querySelector(".footer__icon-wrapper--error")).toBeTruthy();
		expect(container.querySelector(".footer__actions-button")).toBeTruthy();
		expect(container.firstChild).toMatchSnapshot();
	});
});
