import { shuffleArray } from "$lib/dusk/array";
import { derived, writable } from "svelte/store";

export const defaultWordsCount = 12;

/**
 * @type {import('svelte/store').Writable<string[]>}
 * @description Stores the mnemonic phrase as an array of strings.
 */
export const mnemonicPhrase = writable([]);

/**
 * @type {import('svelte/store').Writable<string[]>}
 * @description Stores the user's mnemonic input as an array of strings.
 */
export const enteredMnemonicPhrase = writable([]);

export const shuffledMnemonicPhrase = derived(mnemonicPhrase, $mnemonicPhrase => {
	return shuffleArray($mnemonicPhrase);
}, [""]);
