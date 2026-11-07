/**
 * `npm run build`: Vite's build, with the arguments given, then
 * build/build-manifest.json: the version, the commit built, the mode and the
 * public settings it was built with, Node's and npm's versions, and the
 * SHA-256 of every file in the build. The setup page's footer links to it, and
 * scripts/verify-build.js rebuilds a site from it and compares.
 *
 *   npm run build [-- <vite build options>]
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST = "build-manifest.json";

/**
 * The mode `vite build` builds in, given its options: --mode alone, since the
 * others change the files in ways the manifest couldn't say.
 *
 * @param {string[]} args
 */
export const modeOf = (args) => {
  let mode = "production";

  for (let at = 0; at < args.length; at += 1) {
    const [option, joined] = args[at].split(/=(.*)/s);

    if (option !== "--mode" && option !== "-m") {
      throw new Error(
        `${args[at]}: only --mode can be given, since other options change the build in ways its manifest can't say`
      );
    }

    mode = joined ?? args[(at += 1)];
  }

  if (!/^[\w-]{1,32}$/.test(mode ?? "")) {
    throw new Error(`--mode ${mode ?? ""}: a mode is letters, digits, - and _`);
  }

  return mode;
};

/**
 * Every file in a folder but the manifest, by its path there with "/" between
 * folders, in order, to its SHA-256.
 *
 * @param {string} root
 * @returns {Map<string, string>}
 */
export const hashFiles = (root) =>
  new Map(
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
  const args = process.argv.slice(2);
  let mode;

  try {
    mode = modeOf(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const vite = join(
    dirname(createRequire(import.meta.url).resolve("vite/package.json")),
    "bin/vite.js"
  );
  const { status } = spawnSync(process.execPath, [vite, "build", ...args], {
    stdio: "inherit",
  });

  if (status !== 0) {
    process.exit(status ?? 1);
  }

  const { loadEnv } = await import("vite");
  const { homepage, version } = JSON.parse(
    readFileSync("package.json", "utf8")
  );
  // SvelteKit's version is the commit built (svelte.config.js).
  const { version: commit } = JSON.parse(
    readFileSync("build/_app/version.json", "utf8")
  );
  // Vite puts every VITE_ setting in the code it builds: none is a secret.
  const settings = loadEnv(mode, process.cwd(), "VITE_");
  const manifest = {
    version,
    commit,
    source: `${homepage}/tree/${commit}`,
    mode,
    node: process.version,
    npm: process.env.npm_config_user_agent?.match(/^npm\/(\S+)/)?.[1],
    settings: Object.fromEntries(Object.entries(settings).sort()),
    files: Object.fromEntries(hashFiles("build")),
  };

  writeFileSync(
    join("build", MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}
