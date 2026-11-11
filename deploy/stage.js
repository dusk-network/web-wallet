/**
 * Places the wallet's build where Cloudflare serves it (wrangler.jsonc):
 * build/ as deploy/site/wallet/, in place of what was there, beside
 * deploy/site/_headers. The Deploy workflow runs it after the build, as does
 * anyone serving the build with Wrangler:
 *
 *   npm run build && node deploy/stage.js
 */

import { cpSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the wallet is served, as it's built: its folder in the site. */
export const BASE_PATH = "/wallet";

/**
 * Copies a build to its folder in a site, once what was there is gone: the
 * site serves that build alone. Refuses a build with no manifest, and one
 * built for another base path, whose pages would ask for their files
 * elsewhere.
 *
 * @param {string} build
 * @param {string} site
 */
export const stage = (build, site) => {
  let manifest;

  try {
    manifest = JSON.parse(
      readFileSync(join(build, "build-manifest.json"), "utf8")
    );
  } catch {
    throw new Error(`${build} has no build-manifest.json: run npm run build`);
  }

  const base = manifest?.settings?.VITE_BASE_PATH ?? "";

  if (base !== BASE_PATH) {
    throw new Error(`${build} is built for ${base}/, not for ${BASE_PATH}/`);
  }

  const to = join(site, BASE_PATH);

  rmSync(to, { force: true, recursive: true });
  cpSync(build, to, { recursive: true });

  return to;
};

// Run, not imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const to = stage(
      fileURLToPath(new URL("../build", import.meta.url)),
      fileURLToPath(new URL("site", import.meta.url))
    );

    console.log(`Placed build/ at ${relative(process.cwd(), to)}/`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
