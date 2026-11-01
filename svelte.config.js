import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { loadEnv } from "vite";

const env = loadEnv("", process.cwd());
const fallBackBase = env.VITE_BASE_PATH ? `${env.VITE_BASE_PATH}/` : "";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  kit: {
    adapter: adapter({ fallback: `${fallBackBase}index.html` }),

    paths: {
      base: /** @type {"" | `/${string}` | undefined} */ (env.VITE_BASE_PATH),
      relative: false,
    },
  },
  preprocess: vitePreprocess(),
};

export default config;
