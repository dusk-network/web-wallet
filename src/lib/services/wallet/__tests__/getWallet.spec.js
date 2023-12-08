import {
	describe,
	expect,
	it
} from "vitest";
import { enumerables } from "lamb";
import { generateMnemonic } from "@jimber/simple-bip39";

import { getSeedFromMnemonic } from "$lib/wallet";

import { getWallet } from "..";

describe("getWallet", () => {
	it("should get a Wallet instance using a seed", async () => {
		const mnemonic = generateMnemonic();
		const seed = getSeedFromMnemonic(mnemonic);
		const wallet = await getWallet(seed);

		expect(enumerables(wallet)).toMatchInlineSnapshot(`
			[
			  "wasm",
			  "seed",
			  "gasLimit",
			  "gasPrice",
			  "getBalance",
			  "getPsks",
			  "sync",
			  "transfer",
			  "stake",
			  "stakeInfo",
			  "unstake",
			  "stakeAllow",
			  "withdrawReward",
			  "history",
			]
		`);
	});
});
