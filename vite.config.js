// eslint-disable-next-line import/no-unresolved
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	css: false,
	plugins: [sveltekit()],
	test: {
		/** @see https://github.com/vitest-dev/vitest/issues/2834 */
		alias: [{ find: /^svelte$/, replacement: "svelte/internal" }],
		coverage: {
			all: true,
			exclude: ["**/*.d.ts", "src/routes/components-showcase/**"],
			include: ["src/**"]
		},
		environment: "jsdom",
		include: ["src/**/*.{test,spec}.{js,ts}"],
		setupFiles: ["./vite-setup.js"]
	}
});
