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
    "index.html": "<!doctype html>",
    "setup/index.html": "<!doctype html><title>Setup</title>",
  });

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Placing the build where Cloudflare serves it", () => {
  it("should place the build at its folder in the site, in place of the one there, and leave the rest", () => {
    const built = build();
    const site = folder({
      _headers: "/*\n  X-Frame-Options: DENY\n",
      "wallet/_app/immutable/entry/start.old.js": "an older build's",
    });

    expect(stage(built, site)).toBe(join(site, "wallet"));
    expect(filesIn(join(site, "wallet"))).toEqual(filesIn(built));
    expect(filesIn(site)).toEqual([
      "_headers",
      ...filesIn(built).map((path) => join("wallet", path)),
    ]);
    expect(readFileSync(join(site, "wallet/index.html"), "utf8")).toBe(
      "<!doctype html>"
    );
  });

  it("should refuse a build with no manifest, and one built for another base path", () => {
    const site = folder({ "wallet/index.html": "kept" });

    expect(() => stage(folder({ "index.html": "" }), site)).toThrow(
      "has no build-manifest.json"
    );
    expect(() => stage(build(""), site)).toThrow(
      "is built for /, not for /wallet/"
    );
    expect(() => stage(build("/wallet/app"), site)).toThrow(
      "is built for /wallet/app/, not for /wallet/"
    );
    expect(filesIn(site)).toEqual([join("wallet", "index.html")]);
  });
});
