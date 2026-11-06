/**
 * Writes build/build-manifest.json once `vite build` is done: the version, the
 * commit built, the public settings it was built with, and the SHA-256 of
 * every file in the build. The setup page's footer links to it, and
 * scripts/verify-build.js rebuilds a site from it and compares.
 *
 *   node scripts/build-manifest.js
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST = "build-manifest.json";

/**
 * Every file in a folder but the manifest, by its path there with "/" between
 * folders, in order, to its SHA-256.
 *
 * @param {string} root
 * @returns {Record<string, string>}
 */
export const hashFiles = (root) =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(root, join(entry.parentPath, entry.name)).split(sep).join("/")
      )
      .filter((path) => path !== MANIFEST)
      .sort()
      .map((path) => [
        path,
        createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex"),
      ])
  );

// Run, not imported by scripts/verify-build.js.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadEnv } = await import("vite");
  const { homepage, version } = JSON.parse(
    readFileSync("package.json", "utf8")
  );
  // SvelteKit's version is the commit built (svelte.config.js).
  const { version: commit } = JSON.parse(
    readFileSync("build/_app/version.json", "utf8")
  );
  // Vite puts every VITE_ setting in the code it builds: none is a secret.
  const settings = loadEnv("production", process.cwd(), "VITE_");
  const manifest = {
    version,
    commit,
    source: `${homepage}/tree/${commit}`,
    node: process.version,
    npm: process.env.npm_config_user_agent?.match(/^npm\/(\S+)/)?.[1],
    settings: Object.fromEntries(Object.entries(settings).sort()),
    files: hashFiles("build"),
  };

  writeFileSync(
    join("build", MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}
