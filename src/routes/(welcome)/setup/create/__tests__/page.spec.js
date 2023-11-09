import {
	afterEach,
	describe,
	expect,
	it
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Create from "../+page.svelte";

describe("Create", () => {
	afterEach(cleanup);

	it("should render the Terms Of Service step of the Create flow", () => {
		const { container } = render(Create, { props: { step: "TermsOfService" } });

		expect(container.firstChild).toMatchSnapshot();
	});
});
