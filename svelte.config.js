import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "child_process";
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

    // Registered only by whoever asks to be told when a transfer arrives.
    serviceWorker: { register: false },

    // The commit built, not the time of the build: the same source builds the
    // same files. The footer shows it, and the build manifest records it.
    version: { name: execSync("git rev-parse HEAD").toString().trim() },
  },
  preprocess: vitePreprocess(),
};

export default config;
