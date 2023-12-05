// eslint-disable-next-line import/no-unresolved
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd());

	return {
		define: {
			"process.env": {
				LOCAL_NODE: env.VITE_LOCAL_NODE,
				MAINNET_NODE: env.VITE_MAINNET_NODE,
				RKYV_TREE_LEAF_SIZE: env.VITE_RKYV_TREE_LEAF_SIZE,
				STAKE_CONTRACT: env.VITE_STAKE_CONTRACT,
				TESTNET_NODE: env.VITE_TESTNET_NODE,
				TRANSFER_CONTRACT: env.VITE_TRANSFER_CONTRACT
			}
		},
		plugins: [sveltekit()],
		test: {
			/** @see https://github.com/vitest-dev/vitest/issues/2834 */
			alias: [{ find: /^svelte$/, replacement: "svelte/internal" }],
			coverage: {
				all: true,
				exclude: ["**/*.d.ts", "src/routes/components-showcase/**"],
				include: ["src/**"]
			},
			env: {
				LOCAL_NODE: "http://127.0.0.1:8080/",
				MAINNET_NODE: "http://127.0.0.1:8080/",
				RKYV_TREE_LEAF_SIZE: "632",
				STAKE_CONTRACT: "0200000000000000000000000000000000000000000000000000000000000000",
				TESTNET_NODE: "http://127.0.0.1:8080/",
				TRANSFER_CONTRACT: "0100000000000000000000000000000000000000000000000000000000000000"
			},
			environment: "jsdom",
			include: ["src/**/*.{test,spec}.{js,ts}"],
			setupFiles: ["./vite-setup.js"]
		}
	};
});
