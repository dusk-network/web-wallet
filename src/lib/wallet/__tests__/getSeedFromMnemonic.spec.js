import {
	describe,
	expect,
	it
} from "vitest";
import { entropyToMnemonic, generateMnemonic } from "@jimber/simple-bip39";

import { getSeedFromMnemonic } from "..";

describe("getSeedFromMnemonic", () => {
	it("should convert a mnemonic phrase into a seed", () => {
		const mnemonic = generateMnemonic();
		const seed = getSeedFromMnemonic(mnemonic);

		expect(entropyToMnemonic(seed)).toStrictEqual(mnemonic);
	});
});
