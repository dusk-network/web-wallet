import {
	describe,
	expect,
	it,
	vi
} from "vitest";

// eslint-disable-next-line import/no-unresolved
import init from "@dusk-network/dusk-wallet-core/dusk_wallet_core_bg.wasm?init";

import { getWasmExports } from "..";

describe("getWasmExports", () => {
	it("should return a Promise containing the exports of the WebAssembly instance", async () => {
		expect(getWasmExports()).resolves.toMatchInlineSnapshot(`
			{
			  "A": Global {},
			  "allocate": [Function],
			  "balance": [Function],
			  "bls_scalar_array_rkyv": [Function],
			  "check_note_ownership": [Function],
			  "dusk_to_lux": [Function],
			  "execute": [Function],
			  "filter_notes": [Function],
			  "free_mem": [Function],
			  "get_allow_call_data": [Function],
			  "get_mnemonic_seed": [Function],
			  "get_public_key_rkyv_serialized": [Function],
			  "get_stake_call_data": [Function],
			  "get_stake_info": [Function],
			  "get_stct_proof": [Function],
			  "get_unstake_call_data": [Function],
			  "get_wfct_proof": [Function],
			  "get_withdraw_call_data": [Function],
			  "lux_to_dusk": [Function],
			  "memory": Memory {},
			  "merge_notes": [Function],
			  "new_mnemonic": [Function],
			  "nullifiers": [Function],
			  "prove_tx": [Function],
			  "public_spend_keys": [Function],
			  "rkyv_bls_scalar_array": [Function],
			  "rkyv_notes_array": [Function],
			  "rkyv_openings_array": [Function],
			  "rkyv_tree_leaf": [Function],
			  "rkyv_u64": [Function],
			  "seed": [Function],
			  "unproven_tx_to_bytes": [Function],
			  "unspent_spent_notes": [Function],
			  "view_keys": [Function],
			}
		`);
	});

	it("should store the wasm instance and return it after the first initialization", async () => {
		await getWasmExports();

		expect(init).toHaveBeenCalledTimes(1);

		await getWasmExports();

		expect(init).toHaveBeenCalledTimes(1);

		vi.mocked(init).mockClear();
	});
});
