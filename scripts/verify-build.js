#!/usr/bin/env node
/**
 * Rebuilds the web wallet a site serves from its source, and checks the site
 * against the rebuild and its build manifest: every file, and every page at
 * the addresses browsers open it by.
 *
 * Nothing the site says is trusted. A manifest a build wouldn't write is
 * refused. Its commit is built only when it's on a branch or tag of this clone
 * once origin is fetched. A site deployments.json lists must name the settings
 * listed there, and is rebuilt with those. The commit is built in a new
 * worktree with `npm ci` and `npm run build`; --keep keeps it, to look at.
 *
 *   node scripts/verify-build.js https://apps.dusk.network/wallet/ [--keep]
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hashFiles, MANIFEST } from "./build.js";

const MAX_MANIFEST = 2 ** 21;
const MAX_FILE = 2 ** 26;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const matches = (value, pattern) =>
  typeof value === "string" && pattern.test(value);

/** A path in a build: folders and a file, none of them "." or "..". */
const isBuildPath = (path) =>
  matches(path, /^[^/]{1,128}(\/[^/]{1,128}){0,15}$/) &&
  path.split("/").every((part) => /^[\w~@+-][\w.~@+-]*$/.test(part));

/** An http(s) address, or a path from the site's root. */
const isAddress = (value) => {
  try {
    return value.startsWith("/")
      ? /^\/(?![/\\])[^\s\\]*$/.test(value)
      : ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/**
 * What's wrong with a setting, if anything: a setting is a VITE_ one, a line
 * of plain text, and a path or an address where one is expected.
 */
export const settingProblem = (key, value) =>
  (!matches(key, /^VITE_[A-Z0-9_]{1,64}$/) && "a setting not a VITE_ one") ||
  (!matches(value, /^[\x20-\x7e]{0,2048}$/) && `a ${key} not plain text`) ||
  (key === "VITE_BASE_PATH" &&
    !/^(\/[\w~-][\w.~-]*)*$/.test(value) &&
    `a ${key} not a path`) ||
  (key.endsWith("_URL") &&
    value &&
    !isAddress(value) &&
    `a ${key} not an address`) ||
  "";

/**
 * A site's build manifest, checked before anything is run: what a build
 * wouldn't write is refused.
 */
export const readManifest = (bytes) => {
  if (!bytes) {
    throw new Error(
      `serves no ${MANIFEST}: it was built before builds were reproducible, and can't be rebuilt to the same files`
    );
  }

  let manifest = null;

  try {
    manifest = bytes.length <= MAX_MANIFEST && JSON.parse(bytes.toString());
  } catch {
    // Not one.
  }

  if (!isObject(manifest)) {
    throw new Error(`serves a ${MANIFEST} a build doesn't write`);
  }

  const {
    commit,
    files,
    mode = "production",
    node,
    npm,
    settings,
    version,
  } = manifest;
  const problem = [
    !matches(commit, /^[0-9a-f]{40}$/) && "no commit",
    !matches(version, /^\d+\.\d+\.\d+([-+][\w.-]+)?$/) && "no version",
    !matches(mode, /^[\w-]{1,32}$/) && "an odd mode",
    node !== undefined && !matches(node, /^v\d+\.\d+\.\d+$/) && "an odd Node",
    npm !== undefined && !matches(npm, /^\d+\.\d+\.\d+$/) && "an odd npm",
    !isObject(settings) && "no settings",
    !isObject(files) && "no files",
    ...Object.entries(isObject(settings) ? settings : {}).map(([key, value]) =>
      settingProblem(key, value)
    ),
    ...Object.entries(isObject(files) ? files : {}).map(
      ([path, hash]) =>
        !(isBuildPath(path) && matches(hash, /^[0-9a-f]{64}$/)) &&
        "a file it names oddly"
    ),
  ].find(Boolean);

  if (problem) {
    throw new Error(`serves a ${MANIFEST} with ${problem}`);
  }

  return {
    commit,
    files: new Map(Object.entries(files)),
    mode,
    node,
    settings: new Map(Object.entries(settings)),
    version,
  };
};

/**
 * The settings deployments.json lists for a site and its manifest names
 * differently, by key.
 */
export const settingsDiffer = (listed, named) =>
  [...new Set([...Object.keys(listed), ...named.keys()])]
    .sort()
    .filter((key) => listed[key] !== named.get(key));

/**
 * Where the rebuild, the site's manifest and the site differ: at each file's
 * address, and each page's with and without its last slash, as browsers open
 * it. `get` gives the SHA-256 of what the site serves at an address, or null;
 * told, for a page's index.html and its address without the slash, which a
 * host may send on, the one address they may go to: the page's.
 */
export const compareSite = async (site, rebuilt, listed, get) => {
  const addresses = [];
  const differences = [];

  for (const path of new Set([...rebuilt.keys(), ...listed.keys()])) {
    const file = new URL(
      path.split("/").map(encodeURIComponent).join("/"),
      site
    ).href;

    if (/(^|\/)index\.html$/.test(path)) {
      const page = file.slice(0, -"index.html".length);

      addresses.push(
        [file, path, page],
        [page, path],
        [page.slice(0, -1), path, page]
      );
    } else {
      addresses.push([file, path]);
    }
  }

  for (let next = 0; next < addresses.length; next += 8) {
    await Promise.all(
      addresses.slice(next, next + 8).map(async ([address, path, to]) => {
        const served = await get(address, to);
        const rebuild = rebuilt.get(path);

        if (!rebuild || served !== rebuild || listed.get(path) !== rebuild) {
          differences.push({
            address,
            inManifest: listed.get(path),
            rebuild,
            served,
          });
        }
      })
    );
  }

  differences.sort((a, b) => (a.address < b.address ? -1 : 1));

  return { checked: addresses.length, differences };
};

const REDIRECTS = [301, 302, 303, 307, 308];

/**
 * What a site serves at an address: the SHA-256 of it, or with `limit`, up to
 * a byte over that of it. Null where it serves nothing. Nothing may redirect
 * but a page's address without its last slash, or its index.html, and only to
 * `to`, the page's own, as static hosts do: what a browser fetched from
 * anywhere else, the addresses it reads from there would be checked nowhere.
 */
export const fetchFrom = async (address, { limit, to, get = fetch } = {}) => {
  const ask = (at) =>
    get(at, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
  // Once more where it failed to connect: a connection kept open from before
  // the rebuild, which ran for long, can have been closed since.
  const fetchAt = (at) => ask(at).catch(() => ask(at));
  let response = await fetchAt(address);

  if (
    to &&
    REDIRECTS.includes(response.status) &&
    new URL(response.headers.get("location") ?? "", address).href === to
  ) {
    await response.body?.cancel();
    response = await fetchAt(to);
  }

  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();

    if (!REDIRECTS.includes(response.status)) return null;
    if (limit) throw new Error(`redirects ${new URL(address).pathname}`);

    return "a redirect";
  }

  const hash = createHash("sha256");
  const chunks = [];
  let size = 0;

  for await (const chunk of response.body) {
    size += chunk.length;
    if (limit) chunks.push(chunk);
    else hash.update(chunk);
    if (size > (limit ?? MAX_FILE)) break;
  }

  if (limit) return Buffer.concat(chunks);

  return size > MAX_FILE ? "over 64 MiB" : hash.digest("hex");
};

/** npm's own script beside this Node, where it's there. */
const npmBeside = () =>
  ["node_modules/npm/bin/npm-cli.js", "../lib/node_modules/npm/bin/npm-cli.js"]
    .map((path) => join(dirname(process.execPath), path))
    .find((path) => existsSync(path));

/**
 * How to run npm with the arguments given: from npm's own script, as this
 * Node, where it's beside it, since on Windows npm and npx are .cmd files,
 * which only a shell runs; npm on the PATH otherwise. With a version, that
 * npm, as npx gets it.
 */
export const npmCommand = (version, args, cli = npmBeside()) => {
  const own = version
    ? ["exec", "--yes", `--package=npm@${version}`, "--", "npm", ...args]
    : args;

  return cli ? [process.execPath, [cli, ...own]] : ["npm", own];
};

// Run, not imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const [address, ...rest] = args.filter((arg) => arg !== "--keep");
  const site = URL.parse(address?.endsWith("/") ? address : `${address}/`);

  if (!["http:", "https:"].includes(site?.protocol) || rest.length) {
    console.error("Usage: node scripts/verify-build.js <site> [--keep]");
    process.exit(2);
  }

  let manifest;

  try {
    manifest = readManifest(
      await fetchFrom(new URL(MANIFEST, site).href, { limit: MAX_MANIFEST })
    );
  } catch (error) {
    console.error(`${site.href} ${error.message}.`);
    process.exit(2);
  }

  // The settings the site should be built with, where they're kept here.
  const listed = JSON.parse(
    readFileSync(new URL("../deployments.json", import.meta.url), "utf8")
  )[site.href];
  const differ = listed ? settingsDiffer(listed, manifest.settings) : [];

  for (const key of differ) {
    const [here, there] = [listed[key], manifest.settings.get(key)];

    console.log(
      `  ${key}: ${there ?? "none"} on the site, ${here ?? "none"} listed`
    );
  }

  if (differ.length) {
    console.log(
      `${site.href} isn't built with its settings in deployments.json.`
    );
    process.exit(1);
  }

  if (!listed) {
    console.warn(
      `deployments.json doesn't list ${site.href}: its settings are its own.`
    );
    for (const [key, value] of manifest.settings)
      console.warn(`  ${key}=${value}`);
  }

  if (manifest.node && manifest.node !== process.version) {
    console.warn(
      `The site was built with Node ${manifest.node}, not ${process.version}.`
    );
  }

  const git = (...gitArgs) =>
    execFileSync("git", gitArgs, { encoding: "utf8", stdio: "pipe" }).trim();
  const has = (...gitArgs) => {
    try {
      return git(...gitArgs) !== "";
    } catch {
      return false;
    }
  };

  // A commit on a branch or tag here, never one fetched by its hash: GitHub
  // gives a fork's commit by its hash too, and building it runs its code.
  git("fetch", "--quiet", "origin");

  if (
    !has("branch", "--all", "--contains", manifest.commit) &&
    !has("tag", "--contains", manifest.commit)
  ) {
    console.error(
      `${manifest.commit} is on no branch or tag here: not building it.`
    );
    process.exit(2);
  }

  const dir = mkdtempSync(join(tmpdir(), "web-wallet-verify-"));
  const checkout = [
    "worktree",
    "add",
    "--quiet",
    "--detach",
    dir,
    manifest.commit,
  ];
  let result;

  try {
    git("-c", "core.autocrlf=false", ...checkout);

    // At least the npm the commit asks for, which Node's own may not be.
    const { engines } = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8")
    );
    const floor = engines?.npm?.match(/^>=\s*(\d+\.\d+\.\d+)$/)?.[1];
    // The site's settings, and none of this shell's own.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(VITE_|NODE_ENV$|NODE_OPTIONS$)/.test(key)
      )
    );
    const npm = (...npmArgs) => {
      try {
        execFileSync(...npmCommand(floor, npmArgs), {
          cwd: dir,
          env: { ...env, ...(listed ?? Object.fromEntries(manifest.settings)) },
          stdio: ["ignore", "ignore", "pipe"],
        });
      } catch (error) {
        // What npm or the build said, only when it fails.
        process.stderr.write(error.stderr ?? "");
        throw error;
      }
    };

    console.log(`Building ${manifest.commit} (${manifest.version}) in ${dir}`);
    npm("ci", "--ignore-scripts", "--no-audit", "--no-fund");
    npm("run", "build", "--", "--mode", manifest.mode);

    result = await compareSite(
      site,
      hashFiles(join(dir, "build")),
      manifest.files,
      (at, to) => fetchFrom(at, { to }).catch(() => null)
    );

    const short = (hash) =>
      /^[0-9a-f]{64}$/.test(hash ?? "") ? hash.slice(0, 12) : (hash ?? "none");

    for (const { address, inManifest, rebuild, served } of result.differences) {
      console.log(
        `  ${new URL(address).pathname}: rebuild ${short(rebuild)}, manifest ${short(inManifest)}, site ${short(served)}`
      );
    }

    console.log(
      result.differences.length
        ? `${result.differences.length} of ${result.checked} addresses differ.`
        : `All ${result.checked} addresses match: ${site.href} serves what ${manifest.commit} builds${listed ? " with its settings in deployments.json" : ""}, as its manifest says.`
    );
  } finally {
    if (keep) {
      console.log(`The rebuild is kept in ${dir}`);
    } else {
      git("worktree", "remove", "--force", dir);
    }
  }

  process.exit(result.differences.length ? 1 : 0);
}
