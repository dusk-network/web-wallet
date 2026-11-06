#!/usr/bin/env node
/**
 * Rebuilds the web wallet a site serves from its source, and checks every file
 * three ways: the rebuild, the site's build manifest, and the file the site
 * serves.
 *
 * The commit and the public settings come from the site's manifest. A site
 * built before there was one needs them given: --commit, and --settings with a
 * JSON file of the VITE_ settings (or a manifest). The commit is built in a new
 * worktree with `npm ci` and `npm run build`; --keep keeps it, to look at.
 *
 *   node scripts/verify-build.js https://apps.dusk.network/wallet/
 *   node scripts/verify-build.js <site> --commit <commit> --settings <file>
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashFiles, MANIFEST } from "./build-manifest.js";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);

  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const commitGiven = option("--commit");
const settingsGiven = option("--settings");
const keep = args.includes("--keep");
const [address] = args.filter((arg) => arg !== "--keep");

if (!address) {
  console.error(
    "Usage: node scripts/verify-build.js <site> [--commit <commit> --settings <file>] [--keep]"
  );
  process.exit(2);
}

const site = new URL(address.endsWith("/") ? address : `${address}/`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fetchFile = async (path) => {
  const url = new URL(path.split("/").map(encodeURIComponent).join("/"), site);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

  return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
};
const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { encoding: "utf8" }).trim();

const manifestBytes = await fetchFile(MANIFEST);
let manifest = null;

try {
  manifest = manifestBytes && JSON.parse(manifestBytes.toString("utf8"));
} catch {
  // The site's page in its place: no manifest.
}

const given = settingsGiven && JSON.parse(readFileSync(settingsGiven, "utf8"));
const settings = given ? (given.settings ?? given) : manifest?.settings;
const commit = commitGiven ?? manifest?.commit;

if (!commit || !settings) {
  console.error(`${site} serves no ${MANIFEST}: give --commit and --settings.`);
  process.exit(2);
}

const tools = {
  node: process.version,
  npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
};

for (const [tool, here] of Object.entries(tools)) {
  if (manifest?.[tool] && manifest[tool] !== here) {
    console.warn(
      `The site was built with ${tool} ${manifest[tool]}, not ${here}.`
    );
  }
}

try {
  git("rev-parse", "--verify", "--quiet", `${commit}^{commit}`);
} catch {
  git("fetch", "--quiet", "origin", commit);
}

const dir = mkdtempSync(join(tmpdir(), "web-wallet-verify-"));
let differ = 0;

try {
  git("worktree", "add", "--quiet", "--detach", dir, commit);

  // The site's settings, and none of this shell's own.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("VITE_") && key !== "NODE_ENV"
    )
  );
  const npm = (...npmArgs) => {
    try {
      execFileSync("npm", npmArgs, {
        cwd: dir,
        env: { ...env, ...settings },
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      // What npm or the build said, only when it fails.
      process.stderr.write(error.stderr ?? "");
      throw error;
    }
  };

  console.log(`Building ${commit} in ${dir}`);
  npm("ci", "--ignore-scripts", "--no-audit", "--no-fund");
  npm("run", "build");

  const rebuilt = hashFiles(join(dir, "build"));
  const listed = manifest?.files ?? {};
  const paths = [
    ...new Set([...Object.keys(rebuilt), ...Object.keys(listed)]),
  ].sort();
  const live = {};

  for (let at = 0; at < paths.length; at += 8) {
    await Promise.all(
      paths.slice(at, at + 8).map(async (path) => {
        const bytes = await fetchFile(path);

        live[path] = bytes && sha256(bytes);
      })
    );
  }

  const short = (hash) => (hash ? hash.slice(0, 12) : "none");

  for (const path of paths) {
    if (
      rebuilt[path] &&
      live[path] === rebuilt[path] &&
      (!manifest || listed[path] === rebuilt[path])
    ) {
      continue;
    }

    differ += 1;
    console.log(
      `  ${path}: rebuild ${short(rebuilt[path])}, ${manifest ? `manifest ${short(listed[path])}, ` : ""}site ${short(live[path])}`
    );
  }

  console.log(
    differ
      ? `${differ} of ${paths.length} files differ.`
      : `All ${paths.length} files ${site} serves are what ${commit} builds${manifest ? ", as its manifest says" : ""}.`
  );
} finally {
  if (keep) {
    console.log(`The rebuild is kept in ${dir}`);
  } else {
    git("worktree", "remove", "--force", dir);
  }
}

process.exit(differ ? 1 : 0);
