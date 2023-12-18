import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { generateMnemonic } from "bip39";
import * as appNavigation from "$app/navigation";

import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import { encryptMnemonic, getSeedFromMnemonic } from "$lib/wallet";
import loginInfoStorage from "$lib/services/loginInfoStorage";
import * as walletService from "$lib/services/wallet";

import Login from "../+page.svelte";

/** @param {HTMLElement} container */
function getTextInput (container) {
	// eslint-disable-next-line no-extra-parens
	return /** @type {HTMLInputElement} */ (container.querySelector("[type='password'"));
}

describe("Login", async () => {
	const mnemonic = generateMnemonic();
	const pwd = "some pwd";
	const loginInfo = await encryptMnemonic(mnemonic, pwd);
	const seed = getSeedFromMnemonic(mnemonic);
	const getErrorElement = () => document.querySelector(".login__error");
	const getWalletSpy = vi.spyOn(walletService, "getWallet");
	const gotoSpy = vi.spyOn(appNavigation, "goto");

	afterEach(() => {
		cleanup();
		getWalletSpy.mockClear();
		gotoSpy.mockClear();
	});

	afterAll(() => {
		getWalletSpy.mockRestore();
		gotoSpy.mockRestore();
	});

	describe("Mnemonic phrase workflow", () => {
		it("should render the login page and show the field to enter the mnemonic phrase, if there is no login info stored", () => {
			const { container } = render(Login, {});

			expect(container.firstChild).toMatchSnapshot();
		});

		it("should show an error message if the user enters an invalid mnemonic", async () => {
			const { container } = render(Login, {});
			const form = getAsHTMLElement(container, "form");
			const textInput = getTextInput(container);

			expect(getErrorElement()).toBeNull();

			await fireEvent.input(textInput, { target: { value: "foo bar" } });
			await fireEvent.submit(form, { currentTarget: form });

			const errorElement = await vi.waitUntil(getErrorElement);
			const selectedText = textInput.value.substring(
				Number(textInput.selectionStart),
				Number(textInput.selectionEnd)
			);

			expect(errorElement?.textContent).toMatch(/mnemonic/i);
			expect(textInput).toHaveFocus();
			expect(selectedText).toBe(textInput.value);
		});

		it("should redirect to the dashboard if the user inputs a valid mnemonic", async () => {
			const { container } = render(Login, {});
			const form = getAsHTMLElement(container, "form");
			const textInput = getTextInput(container);

			await fireEvent.input(textInput, { target: { value: mnemonic } });
			await fireEvent.submit(form, { currentTarget: form });
			await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

			expect(getWalletSpy).toHaveBeenCalledTimes(1);
			expect(getWalletSpy).toHaveBeenCalledWith(seed);
			expect(gotoSpy).toHaveBeenCalledTimes(1);
			expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
		});

		it("should trim the entered mnemonic before validating it", async () => {
			const { container } = render(Login, {});
			const form = getAsHTMLElement(container, "form");
			const textInput = getTextInput(container);

			await fireEvent.input(textInput, { target: { value: `  \t${mnemonic} \t  ` } });
			await fireEvent.submit(form, { currentTarget: form });
			await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

			expect(getWalletSpy).toHaveBeenCalledTimes(1);
			expect(getWalletSpy).toHaveBeenCalledWith(seed);
			expect(gotoSpy).toHaveBeenCalledTimes(1);
			expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
		});
	});

	describe("Password workflow", () => {
		beforeAll(() => {
			loginInfoStorage.set(loginInfo);

			return () => loginInfoStorage.remove();
		});

		it("should show the password field and the link to restore the wallet if there is login info stored", () => {
			const { container } = render(Login, {});

			expect(container.firstChild).toMatchSnapshot();
		});

		it("should show an error message if the user enters the wrong password", async () => {
			const { container } = render(Login, {});
			const form = getAsHTMLElement(container, "form");
			const textInput = getTextInput(container);

			expect(getErrorElement()).toBeNull();

			await fireEvent.input(textInput, { target: { value: "foo bar" } });
			await fireEvent.submit(form, { currentTarget: form });

			const errorElement = await vi.waitUntil(getErrorElement);
			const selectedText = textInput.value.substring(
				Number(textInput.selectionStart),
				Number(textInput.selectionEnd)
			);

			expect(errorElement?.textContent).toMatch(/password/i);
			expect(textInput).toHaveFocus();
			expect(selectedText).toBe(textInput.value);
		});

		it("should redirect to the dashboard if the user inputs the correct password", async () => {
			const { container } = render(Login, {});
			const form = getAsHTMLElement(container, "form");
			const textInput = getTextInput(container);

			await fireEvent.input(textInput, { target: { value: pwd } });
			await fireEvent.submit(form, { currentTarget: form });
			await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

			expect(getWalletSpy).toHaveBeenCalledTimes(1);
			expect(getWalletSpy).toHaveBeenCalledWith(seed);
			expect(gotoSpy).toHaveBeenCalledTimes(1);
			expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
		});

		it("should trim the entered password before validating it", async () => {
			const { container } = render(Login, {});
			const form = getAsHTMLElement(container, "form");
			const textInput = getTextInput(container);

			await fireEvent.input(textInput, { target: { value: `  \t${pwd} \t  ` } });
			await fireEvent.submit(form, { currentTarget: form });
			await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

			expect(getWalletSpy).toHaveBeenCalledTimes(1);
			expect(getWalletSpy).toHaveBeenCalledWith(seed);
			expect(gotoSpy).toHaveBeenCalledTimes(1);
			expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
		});
	});
});
