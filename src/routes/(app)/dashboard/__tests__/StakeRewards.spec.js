import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { logo } from "$lib/dusk/icons";
import { mdiDatabaseOutline, mdiLockOpenVariantOutline, mdiLockOutline } from "@mdi/js";
import StakeRewards from "../Contract/Operations/StakeRewards/StakeRewards.svelte";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";

describe("StakeRewards", () => {
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

	const props = { statuses };

	afterEach(cleanup);

	it("renders the StakeRewards step component", () => {
		const { container } = render(StakeRewards, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("checks the displayed rewards amount", () => {
		const { container } = render(StakeRewards, props);

		const value = getAsHTMLElement(container, ".operation__stake-rewards-value span");

		const rewards = statuses.filter((status) => {
			return status.key.label === "Reward tokens";
		})[0];

		expect(value.textContent).toBe(rewards.value.label);
	});
});
