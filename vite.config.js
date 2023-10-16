// eslint-disable-next-line import/no-unresolved
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	css: false,
	plugins: [sveltekit()],
	test: {
		coverage: {
			all: true,
			exclude: ["**/*.d.ts"],
			include: ["src/**"]
		},
		environment: "jsdom",
		include: ["src/**/*.{test,spec}.{js,ts}"],
		setupFiles: ["./vite-setup.js"]
	}
});
