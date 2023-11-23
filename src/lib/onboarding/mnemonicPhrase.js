import { shuffleArray } from "$lib/dusk/array";
import { derived, writable } from "svelte/store";

export const mnemonicPhrase = writable([""]);

export const shuffledMnemonicPhrase = derived(mnemonicPhrase, $mnemonicPhrase => {
	return shuffleArray($mnemonicPhrase);
}, [""]);
