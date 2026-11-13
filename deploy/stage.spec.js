import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BASE_PATH, stage } from "./stage.js";

/** A page's own policy, as kit.csp writes it in its head, with its hash. */
const head = (/** @type {string} */ hash) =>
  `<!doctype html><meta http-equiv="content-security-policy" content="default-src 'self'; connect-src 'self' https://testnet.nodes.dusk.network; script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'">`;

/** @type {string[]} */
const made = [];

/**
 * A folder of its own, with the files given.
 *
 * @param {Record<string, string>} files
 */
const folder = (files) => {
  const root = mkdtempSync(join(tmpdir(), "web-wallet-stage-"));

  made.push(root);

  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }

  return root;
};

/** @param {string} root */
const filesIn = (root) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();

/** A build's own files, built for the base path given. */
const build = (base = BASE_PATH) =>
  folder({
    "_app/immutable/entry/start.x.js": "start",
    "build-manifest.json": JSON.stringify({
      settings: { VITE_BASE_PATH: base },
    }),
    "index.html": head("a1"),
    "setup/index.html": `${head("b2")}<title>Setup</title>`,
  });

/** deploy/headers, as the stage takes it. */
const headers = () =>
  join(
    folder({
      headers:
        "# Cloudflare's: the policy in place of PAGE_POLICY.\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: PAGE_POLICY\n",
    }),
    "headers"
  );

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Placing the build where Cloudflare serves it", () => {
  it("should place the build at its folder in the site, in place of the one there, with the headers beside it", () => {
    const built = build();
    const site = folder({
      "wallet/_app/immutable/entry/start.old.js": "an older build's",
    });

    expect(stage(built, site, headers())).toBe(join(site, "wallet"));
    expect(filesIn(join(site, "wallet"))).toEqual(filesIn(built));
    expect(filesIn(site)).toEqual([
      "_headers",
      ...filesIn(built).map((path) => join("wallet", path)),
    ]);
    expect(readFileSync(join(site, "wallet/index.html"), "utf8")).toBe(
      head("a1")
    );
  });

  it("should send the policy the build's pages carry as their header, with every page's hashes and frame-ancestors, which a page's own can't say", () => {
    const site = folder({});

    stage(build(), site, headers());

    expect(readFileSync(join(site, "_headers"), "utf8")).toBe(
      "# Cloudflare's: the policy in place of PAGE_POLICY.\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: frame-ancestors 'none'; default-src 'self'; connect-src 'self' https://testnet.nodes.dusk.network; script-src 'self' 'wasm-unsafe-eval' 'sha256-a1' 'sha256-b2'; style-src 'self' 'unsafe-inline'\n"
    );
  });

  it("should refuse a build whose page carries no policy, as one built without kit.csp, before anything is placed", () => {
    const built = folder({
      "build-manifest.json": JSON.stringify({
        settings: { VITE_BASE_PATH: BASE_PATH },
      }),
      "index.html": head("a1"),
      "setup/index.html": "<!doctype html><title>Setup</title>",
    });
    const site = folder({ "wallet/index.html": "kept" });

    expect(() => stage(built, site, headers())).toThrow(
      `${join("setup", "index.html")} carries no Content-Security-Policy`
    );
    expect(filesIn(site)).toEqual([join("wallet", "index.html")]);
  });

  it("should refuse a build with no manifest, and one built for another base path", () => {
    const site = folder({ "wallet/index.html": "kept" });

    expect(() => stage(folder({ "index.html": "" }), site, headers())).toThrow(
      "has no build-manifest.json"
    );
    expect(() => stage(build(""), site, headers())).toThrow(
      "is built for /, not for /wallet/"
    );
    expect(() => stage(build("/wallet/app"), site, headers())).toThrow(
      "is built for /wallet/app/, not for /wallet/"
    );
    expect(filesIn(site)).toEqual([join("wallet", "index.html")]);
  });
});
