import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { logo } from "$lib/dusk/icons";
import { mdiDatabaseOutline, mdiLockOpenVariantOutline, mdiLockOutline } from "@mdi/js";
import Stake from "../Contract/Operations/Stake.svelte";

describe("Withdraw", () => {
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

	it("renders the Withdraw step component", () => {
		const { container } = render(Stake, { props: { statuses, flow: "withdraw-stake" } });

		expect(container.firstChild).toMatchSnapshot();
	});
	it("renders the Withdraw Review step component", async () => {
		const { container, getByRole } = render(Stake, { props: { statuses, flow: "withdraw-stake" } });

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		expect(container.firstChild).toMatchSnapshot();
	});
	it("renders the Withdraw Confirmation step component", async () => {
		const { container, getByRole } = render(Stake, { props: { statuses, flow: "withdraw-stake" } });

		const next = getByRole("button", { name: "Next" });

		await fireEvent.click(next);

		const stake = getByRole("button", { name: "WITHDRAW" });

		await fireEvent.click(stake);

		expect(container.firstChild).toMatchSnapshot();
	});
});
