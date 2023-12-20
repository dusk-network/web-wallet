import { mockDerivedStore, mockReadableStore } from "$lib/dusk/test-helpers";

/** @type {Array<string>} */
const enteredSeed = [];
const seed = ["auction", "tribe", "type", "torch", "domain", "auction",
	"lyrics", "mouse", "alert", "fabric", "snake", "ticket"];

/** @param {Array<string>} initialSeed */
const deriveFn = (initialSeed) => {
	return initialSeed;
};

export const mockedMnemonicPhrase = mockReadableStore(seed);
export const mockedEnteredMnemonicPhrase = mockReadableStore(enteredSeed);
export const mockedShuffledMnemonicPhrase = mockDerivedStore(seed, deriveFn);
