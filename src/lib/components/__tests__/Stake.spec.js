import {
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { Stake } from "..";

describe("Stake", () => {
	/** @type {(n: number) => string} */
	const formatter = n => n.toString().replace(/(\d(?!$))/g, "$1-");
	const lastTxId = "some-id";

	const baseProps = {
		execute: vi.fn().mockResolvedValue(lastTxId),
		fee: (1 * 20000000 * 0.000000001).toString(),

		/** @type {StakeType} */
		flow: "stake",
		formatter,
		gasSettings: {
			fee: (1 * 20000000 * 0.000000001).toString(),
			gasLimit: 20000000,
			gasLimitLower: 10000000,
			gasLimitUpper: 1000000000,
			gasPrice: 1,
			gasPriceLower: 1
		},
		rewards: 345,
		spendable: 1000,
		staked: 278,
		statuses: [{
			label: "Spendable",
			value: "1,000.000000000"
		}, {
			label: "Total Locked",
			value: "278.000000000"
		}, {
			label: "Rewards",
			value: "345.000000000"
		}]
	};

	afterEach(() => {
		cleanup();
		baseProps.execute.mockClear();
	});

	it("renders the Stake component", () => {
		const { container } = render(Stake, baseProps);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("sets the max amount on click", async () => {
		const { getByRole } = render(Stake, baseProps);

		const component = getByRole("button", { name: "USE MAX" });

		await fireEvent.click(component);

		const input = getByRole("spinbutton");

		expect(input).toHaveValue(baseProps.spendable);
	});
});
