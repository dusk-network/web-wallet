import {
	afterEach,
	describe,
	expect,
	it
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import Login from "../+page.svelte";

describe("Login", () => {
	afterEach(cleanup);

	it("should render the login page", () => {
		const { container } = render(Login, {});

		expect(container.firstChild).toMatchSnapshot();
	});
});
