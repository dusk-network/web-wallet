/**
 * Places the wallet's build where Cloudflare serves it (wrangler.jsonc):
 * build/ as deploy/site/wallet/, in place of what was there, and
 * deploy/headers as deploy/site/_headers beside it, with the policy the
 * build's pages carry as their Content-Security-Policy. The Deploy workflow
 * runs it after the build, as does anyone serving the build with Wrangler:
 *
 *   npm run build && node deploy/stage.js
 */

import {
  cpSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the wallet is served, as it's built: its folder in the site. */
export const BASE_PATH = "/wallet";

/** What deploy/headers says in place of the pages' policy. */
export const PAGE_POLICY = "PAGE_POLICY";

/** A page's own policy, as kit.csp writes it in its head. */
const META = /<meta http-equiv="content-security-policy" content="([^"]*)">/i;

/** @param {string} text What an attribute's value holds, escaped */
const unescaped = (text) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/**
 * The policy a build's pages carry, as one header for all of them: each
 * directive with every page's sources, so every page's own inline scripts'
 * hashes, and frame-ancestors, which a page's own policy can't say. Refuses
 * a build with a page that carries none, as one built without kit.csp.
 *
 * @param {string} build
 * @returns {string}
 */
export function pagePolicy(build) {
  const pages = readdirSync(build, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

  /** @type {Map<string, Set<string>>} */
  const directives = new Map([["frame-ancestors", new Set(["'none'"])]]);

  if (!pages.length) {
    throw new Error(`${build} has no page`);
  }

  for (const page of pages) {
    const policy = readFileSync(page, "utf8").match(META)?.[1];

    if (!policy) {
      throw new Error(
        `${relative(build, page)} carries no Content-Security-Policy: build it with kit.csp`
      );
    }

    for (const directive of unescaped(policy).split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);

      if (name) {
        const kept = directives.get(name) ?? new Set();

        directives.set(name, kept);
        sources.forEach((source) => kept.add(source));
      }
    }
  }

  return [...directives]
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

/**
 * Copies a build to its folder in a site, once what was there is gone: the
 * site serves that build alone. Writes `headers` beside it as the site's
 * _headers, with the policy the build's pages carry. Refuses a build with no
 * manifest, one built for another base path, whose pages would ask for their
 * files elsewhere, and one whose pages carry no policy.
 *
 * @param {string} build
 * @param {string} site
 * @param {string} headers Cloudflare's headers, with PAGE_POLICY in them
 */
export const stage = (build, site, headers) => {
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

  const policy = pagePolicy(build);
  // The policy in place of the mark, in the rules: not in what they say of it.
  const lines = readFileSync(headers, "utf8").split("\n");

  if (
    !lines.some((line) => !line.startsWith("#") && line.includes(PAGE_POLICY))
  ) {
    throw new Error(`${headers} has no ${PAGE_POLICY} to put the policy in`);
  }

  const rules = lines
    .map((line) =>
      line.startsWith("#") ? line : line.replaceAll(PAGE_POLICY, policy)
    )
    .join("\n");

  const to = join(site, BASE_PATH);

  rmSync(to, { force: true, recursive: true });
  cpSync(build, to, { recursive: true });
  writeFileSync(join(site, "_headers"), rules);

  return to;
};

// Run, not imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const to = stage(
      fileURLToPath(new URL("../build", import.meta.url)),
      fileURLToPath(new URL("site", import.meta.url)),
      fileURLToPath(new URL("headers", import.meta.url))
    );

    console.log(
      `Placed build/ at ${relative(process.cwd(), to)}/, with its policy in _headers`
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
