import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import {
	cleanup,
	fireEvent,
	render
} from "@testing-library/svelte";

import {
	mockedEnteredMnemonicPhrase,
	mockedMnemonicPhrase,
	mockedShuffledMnemonicPhrase
} from "../__mocks__/mockedMnemonicStore.js";
import { Mnemonic } from "..";

vi.mock("../Mnemonic/store.js", async importOriginal => {
	/** @type {import('svelte/store').Writable<string[]>} */
	const original = await importOriginal();

	return {
		...original,
		mnemonicPhrase: mockedMnemonicPhrase,
		enteredMnemonicPhrase: mockedEnteredMnemonicPhrase,
		shuffledMnemonicPhrase: mockedShuffledMnemonicPhrase
	};
});

describe("Mnemonic", () => {
	const initialMnemonicState = structuredClone(mockedMnemonicPhrase.getMockedStoreValue());
	const initialEnteredMnemonicState = structuredClone(mockedEnteredMnemonicPhrase.getMockedStoreValue());

	beforeEach(() => {
		mockedMnemonicPhrase.setMockedStoreValue(initialMnemonicState);
		mockedEnteredMnemonicPhrase.setMockedStoreValue(initialEnteredMnemonicState);
		mockedShuffledMnemonicPhrase.derivedMockedStoreValue();
	});

	afterEach(cleanup);

	afterAll(() => {
		vi.doUnmock("../Mnemonic/store");
	});

	it("should render the \"Mnemonic\" component in the authenticate state", async () => {
		const { container } = render(Mnemonic, { props: { type: "authenticate" } });

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should render the \"Mnemonic\" component in the validate state", () => {
		const { container } = render(Mnemonic, { props: { type: "validate" } });

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should display all the words in the order they have been clicked", async () => {
		const { getAllByRole } = render(Mnemonic, { props: { type: "validate" } });

		const buttons = getAllByRole("button");

		for (const word of buttons) {
			await fireEvent.click(word);

			expect(word).toBeDisabled();
		}

		const enteredPhrase = getAllByRole("listitem");

		enteredPhrase.forEach((word, index) => {
			expect(word.textContent).toBe(buttons[index].textContent);
		});
	});
});
