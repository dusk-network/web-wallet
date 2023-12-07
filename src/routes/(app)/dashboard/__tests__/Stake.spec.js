import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { logo } from "$lib/dusk/icons";
import { mdiDatabaseOutline, mdiLockOpenVariantOutline, mdiLockOutline } from "@mdi/js";
import Stake from "../Contract/Operations/Stake.svelte";

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

	const props = { statuses };

	afterEach(cleanup);

	it("renders the Stake component", () => {
		const { container } = render(Stake, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("sets the max amount on click", async () => {
		vi.useFakeTimers();

		const { getByRole } = render(Stake, props);

		const component = getByRole("button", { name: "USE MAX" });

		vi.advanceTimersByTime(500);

		await fireEvent.click(component);

		const input = getByRole("spinbutton");

		expect(input).toHaveValue(parseFloat(statuses[0].value.label.replace(/,/g, "")));
	});
});
