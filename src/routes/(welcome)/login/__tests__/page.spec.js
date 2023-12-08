import {
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import loginInfoStorage from "$lib/services/loginInfoStorage";

import Login from "../+page.svelte";

describe("Login", () => {
	afterEach(cleanup);

	it("should render the login page and show the field to enter the mnemonic phrase, if there is no login info stored", () => {
		const { container } = render(Login, {});

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should show the password field and the link to restore the wallet if there is login info stored", () => {
		const getInfoSpy = vi.spyOn(loginInfoStorage, "get").mockReturnValue({
			data: Uint8Array.of(1, 2, 3),
			iv: Uint8Array.of(1, 2, 3),
			salt: Uint8Array.of(1, 2, 3)
		});
		const { container } = render(Login, {});

		expect(container.firstChild).toMatchSnapshot();

		getInfoSpy.mockRestore();
	});
});
