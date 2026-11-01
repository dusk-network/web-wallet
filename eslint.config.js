import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier/flat";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

import svelteConfig from "./svelte.config.js";

export default defineConfig([
  js.configs.recommended,
  svelte.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Vite's `define` sets it at build time.
        CONFIG: "readonly",
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        svelteConfig,
      },
    },
    rules: {
      // Links get the base path from `addBasePath` (AppAnchor), not `resolve`.
      "svelte/no-navigation-without-resolve": ["error", { ignoreLinks: true }],
    },
  },
  globalIgnores([".svelte-kit/", "build/", "coverage/", "src/lib/vendor/"]),
]);
