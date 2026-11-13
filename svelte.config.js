import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "child_process";
import { loadEnv } from "vite";

import { cspDirectives } from "./scripts/csp.js";

// The settings Vite gives the pages: the .env files of the mode it builds
// in, which vite.config.js names, under the VITE_ variables it runs with, as
// deployments.json's in the Deploy workflow and scripts/verify-build.js.
const env = loadEnv(process.env.WEB_WALLET_MODE ?? "production", process.cwd());
const fallBackBase = env.VITE_BASE_PATH ? `${env.VITE_BASE_PATH}/` : "";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  kit: {
    adapter: adapter({ fallback: `${fallBackBase}index.html` }),

    // Only the wallet's own scripts, its inline ones by their hashes, which
    // every page carries in its policy, and what it reads from
    // (scripts/csp.js): Cloudflare sends it as a header too
    // (deploy/stage.js).
    csp: { directives: cspDirectives(env), mode: "hash" },

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
