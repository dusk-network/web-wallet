import {
	afterEach,
	describe,
	expect,
	it
} from "vitest";
import {
	cleanup,
	render
} from "@testing-library/svelte";
import { mdiDatabaseOutline } from "@mdi/js";

import { StatusList } from "..";

/** @type {Status[]} */
const statuses = [{
	key: {
		icon: {
			label: "",
			path: mdiDatabaseOutline
		},
		label: "Unlocked tokens"

	}, value: {
		icon: {
			label: "DUSK",
			path: mdiDatabaseOutline
		},
		label: "10,000,000"
	}
}, {
	key: {
		icon: {
			label: "",
			path: mdiDatabaseOutline
		},
		label: "Locked tokens"
	}, value: {
		icon: {
			label: "DUSK",
			path: mdiDatabaseOutline
		},
		label: "10,000,000"
	}
}, {
	key: {
		icon: {
			label: "",
			path: mdiDatabaseOutline
		},
		label: "Reward tokens"
	},
	value: {
		icon: {
			label: "DUSK",
			path: mdiDatabaseOutline
		},
		label: "5,000,000"
	}
}];

describe("StatusList", () => {
	const baseProps = {
		statuses
	};
	const baseOptions = {
		props: baseProps,
		target: document.body
	};

	afterEach(cleanup);

	it("should render the StatusList component", () => {
		const { container } = render(StatusList, baseOptions);

		expect(container.firstChild).toMatchSnapshot();
	});
});
