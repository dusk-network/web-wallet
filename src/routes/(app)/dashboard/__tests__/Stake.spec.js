import {
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { mdiDatabaseOutline, mdiLockOpenVariantOutline, mdiLockOutline } from "@mdi/js";

import { logo } from "$lib/dusk/icons";

import mockedWalletStore from "../__mocks__/mockedWalletStore";
import Stake from "../Contract/Operations/Stake.svelte";

vi.mock("$lib/stores", async importOriginal => {
	/** @type {import("$lib/stores/stores").WalletStore} */
	const original = await importOriginal();

	return {
		...original,
		walletStore: mockedWalletStore
	};
});

describe("Stake", () => {
	const statuses = [
		{
			"key": {
				icon: {
					path: mdiLockOpenVariantOutline
				},
				label: "Unlocked tokens"
			},
			"value": {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: "50,000.00"
			}
		},
		{
			"key": {
				icon: {
					path: mdiLockOutline
				},
				label: "Locked tokens"
			},
			"value": {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: "50,000.00"
			}
		},
		{
			"key": {
				icon: {
					path: mdiDatabaseOutline
				},
				label: "Reward tokens"
			},
			"value": {
				icon: {
					label: "DUSK",
					path: logo
				},
				label: "50,000.00"
			}
		}
	];

	afterEach(cleanup);

	afterAll(() => {
		vi.doUnmock("$lib/stores");
	});

	it("renders the Stake component", () => {
		const { container } = render(Stake, { props: { statuses, flow: "stake" } });

		expect(container.firstChild).toMatchSnapshot();
	});

	it("sets the max amount on click", async () => {
		const { getByRole } = render(Stake, { props: { statuses, flow: "stake" } });

		const component = getByRole("button", { name: "USE MAX" });

		await fireEvent.click(component);

		const input = getByRole("spinbutton");

		expect(input).toHaveValue(mockedWalletStore.getMockedStoreValue().balance.maximum);
	});
});
