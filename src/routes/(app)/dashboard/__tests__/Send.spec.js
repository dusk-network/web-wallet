import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { logo } from "$lib/dusk/icons";
import Send from "../Contract/Operations/Send.svelte";

describe("Send", () => {
	const statuses = [
		{
			key: {
				icon: {
					path: logo
				},
				label: "Spendable tokens"
			},
			value: {
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

	it("renders the Send component", () => {
		const { container } = render(Send, props);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("sets the max amount on click", async () => {
		vi.useFakeTimers();

		const { getByRole } = render(Send, props);

		const component = getByRole("button", { name: "USE MAX" });

		vi.advanceTimersByTime(500);

		await fireEvent.click(component);

		const input = getByRole("spinbutton");

		expect(input).toHaveValue(parseFloat(statuses[0].value.label.replace(/,/g, "")));
	});
});
