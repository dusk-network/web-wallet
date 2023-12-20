// eslint-disable-next-line import/no-unresolved
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, loadEnv } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd());
	const commonPlugins = [
		sveltekit(),
		nodePolyfills({
			globals: { Buffer: true },
			include: ["buffer"]
		})
	];

	return {
		define: {
			"CONFIG": {
				LOCAL_STORAGE_APP_KEY: process.env.npm_package_name
			},
			"process.env": {
				LOCAL_NODE: env.VITE_LOCAL_NODE,
				MAINNET_NODE: env.VITE_MAINNET_NODE,
				RKYV_TREE_LEAF_SIZE: env.VITE_RKYV_TREE_LEAF_SIZE,
				STAKE_CONTRACT: env.VITE_STAKE_CONTRACT,
				TESTNET_NODE: env.VITE_TESTNET_NODE,
				TRANSFER_CONTRACT: env.VITE_TRANSFER_CONTRACT,
				VITE_GAS_LIMIT_DEFAULT: env.VITE_GAS_LIMIT_DEFAULT,
				VITE_GAS_LIMIT_LOWER: env.VITE_GAS_LIMIT_LOWER,
				VITE_GAS_LIMIT_UPPER: env.VITE_GAS_LIMIT_UPPER,
				VITE_GAS_PRICE_DEFAULT: env.VITE_GAS_PRICE_DEFAULT,
				VITE_GAS_PRICE_LOWER: env.VITE_GAS_PRICE_LOWER,
				VITE_GAS_PRICE_UPPER: env.VITE_GAS_PRICE_UPPER
			}
		},
		plugins: mode === "development" ? [basicSsl(), ...commonPlugins] : commonPlugins,
		server: {
			proxy: {
				"/rusk": {
					rewrite: path => path.replace(/^\/rusk/, ""),
					target: "http://localhost:8080/"
				}
			}
		},
		test: {
			/** @see https://github.com/vitest-dev/vitest/issues/2834 */
			alias: [{ find: /^svelte$/, replacement: "svelte/internal" }],
			coverage: {
				all: true,
				exclude: ["**/*.d.ts", "src/routes/components-showcase/**"],
				include: ["src/**"]
			},
			env: {
				LOCAL_NODE: "https://nodes.dusk.network/",
				MAINNET_NODE: "http://127.0.0.1:8080/",
				RKYV_TREE_LEAF_SIZE: "632",
				STAKE_CONTRACT: "0200000000000000000000000000000000000000000000000000000000000000",
				TESTNET_NODE: "http://127.0.0.1:8080/",
				TRANSFER_CONTRACT: "0100000000000000000000000000000000000000000000000000000000000000",
				VITE_GAS_LIMIT_DEFAULT: "20000000",
				VITE_GAS_LIMIT_LOWER: "10000000",
				VITE_GAS_LIMIT_UPPER: "1000000000",
				VITE_GAS_PRICE_DEFAULT: "1",
				VITE_GAS_PRICE_LOWER: "1"
			},
			environment: "jsdom",
			include: ["src/**/*.{test,spec}.{js,ts}"],
			setupFiles: ["./vite-setup.js"]
		}
	};
});
