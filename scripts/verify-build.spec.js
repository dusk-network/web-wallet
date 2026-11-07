import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { modeOf } from "./build.js";
import {
  compareSite,
  fetchFrom,
  npmCommand,
  readManifest,
  settingProblem,
  settingsDiffer,
} from "./verify-build.js";

const SITE = new URL("https://wallet.example/wallet/");
const COMMIT = "a".repeat(40);
const hash = (/** @type {string} */ digit) => digit.repeat(64);

/** A manifest as a build writes it, with the changes given. */
const manifest = (changes = {}) =>
  Buffer.from(
    JSON.stringify({
      commit: COMMIT,
      files: {
        "_app/immutable/chunks/-dNcaVtT.js": hash("3"),
        "index.html": hash("1"),
        "setup/index.html": hash("2"),
      },
      mode: "production",
      node: "v24.13.0",
      npm: "11.18.0",
      settings: {
        VITE_BASE_PATH: "/wallet",
        VITE_EVM_BRIDGE_BLOCK_EXPLORER_NAME: "DuskEVM Explorer",
        VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL: "/wallet/drivers/portal.wasm",
        VITE_NODE_URL: "https://nodes.dusk.network/",
      },
      version: "2.0.0",
      ...changes,
    })
  );

describe("Verifying a deployment", () => {
  it("should refuse a manifest a build wouldn't write before running anything, and a site without one", () => {
    expect(readManifest(manifest())).toMatchObject({
      commit: COMMIT,
      mode: "production",
    });
    expect(() => readManifest(null)).toThrow(
      "built before builds were reproducible"
    );

    for (const changes of [
      { settings: { NODE_OPTIONS: "--import=data:text/javascript,x" } },
      { settings: { npm_config_registry: "https://registry.example/" } },
      { settings: { VITE_NODE_URL: "https://nodes.dusk.network/\nX=1" } },
      { settings: { VITE_NODE_URL: "javascript:alert(1)" } },
      { settings: { VITE_NODE_URL: "//elsewhere.example/" } },
      { settings: { VITE_BASE_PATH: "/../../tmp" } },
      { settings: { VITE_FEATURE_STAKE: 1 } },
      { commit: "--upload-pack=touch x" },
      { files: { "../../.bashrc": hash("1") } },
      { files: { "a/./b.js": hash("1") } },
      { files: { "//elsewhere.example/x.js": hash("1") } },
      { files: { "x.js": "not a hash" } },
      { mode: "../production" },
      { node: "v24.13.0\u001b[2K" },
    ]) {
      expect(() => readManifest(manifest(changes))).toThrow(
        "serves a build-manifest.json with"
      );
    }
  });

  it("should check each page at the addresses browsers open it by, with and without its last slash", async () => {
    const { files } = readManifest(manifest());
    const served = new Map(
      [...files].flatMap(([path, digest]) => {
        const file = new URL(path, SITE).href;

        return path.endsWith("index.html")
          ? [
              [file, digest],
              [file.slice(0, -10), digest],
              [file.slice(0, -11), digest],
            ]
          : [[file, digest]];
      })
    );
    const get = async (/** @type {string} */ address) =>
      served.get(address) ?? null;

    expect((await compareSite(SITE, files, files, get)).differences).toEqual(
      []
    );

    for (const page of [
      "https://wallet.example/wallet/",
      "https://wallet.example/wallet",
      "https://wallet.example/wallet/setup/",
      "https://wallet.example/wallet/setup",
    ]) {
      const kept = served.get(page);

      served.set(page, hash("9"));
      expect(
        (await compareSite(SITE, files, files, get)).differences
      ).toMatchObject([{ address: page, rebuild: kept, served: hash("9") }]);
      served.set(page, kept);
    }
  });

  it("should hold a listed deployment to its settings in deployments.json, all of which a manifest may name", () => {
    const deployments = JSON.parse(readFileSync("deployments.json", "utf8"));

    for (const settings of Object.values(deployments)) {
      for (const [key, value] of Object.entries(settings)) {
        expect(settingProblem(key, value)).toBe("");
      }
    }

    expect(
      settingsDiffer(
        { VITE_A: "1", VITE_B: "2" },
        new Map([
          ["VITE_A", "1"],
          ["VITE_B", "3"],
          ["VITE_C", "4"],
        ])
      )
    ).toEqual(["VITE_B", "VITE_C"]);
  });

  it("should build in the mode Vite is given, and refuse options a manifest can't say", () => {
    expect(modeOf([])).toBe("production");
    expect(modeOf(["--mode", "staging"])).toBe("staging");
    expect(modeOf(["--mode=staging"])).toBe("staging");
    expect(modeOf(["-m", "staging"])).toBe("staging");
    expect(() => modeOf(["--minify", "false"])).toThrow("only --mode");
    expect(() => modeOf(["-m", "staging", "--sourcemap"])).toThrow(
      "only --mode"
    );
    expect(() => modeOf(["--mode", "../staging"])).toThrow("a mode is");
    expect(() => modeOf(["--mode"])).toThrow("a mode is");
  });

  it("should follow a redirect on the site, as static hosts make from a page's address without its slash, and none off it", async () => {
    const page = "<!doctype html>";
    const redirect = (/** @type {string} */ location) =>
      new Response(null, { headers: { location }, status: 301 });
    /** @type {Record<string, () => Response>} */
    const served = {
      "https://wallet.example/wallet/away": () =>
        redirect("https://elsewhere.example/wallet/setup/"),
      "https://wallet.example/wallet/loop": () => redirect("/wallet/loop"),
      "https://wallet.example/wallet/setup": () => redirect("/wallet/setup/"),
      "https://wallet.example/wallet/setup/": () => new Response(page),
    };
    const get = async (/** @type {string} */ address) =>
      served[address]?.() ?? new Response(null, { status: 404 });

    expect(
      await fetchFrom("https://wallet.example/wallet/setup", undefined, get)
    ).toBe(createHash("sha256").update(page).digest("hex"));
    expect(
      await fetchFrom("https://wallet.example/wallet/away", undefined, get)
    ).toBe("redirects off the site");
    expect(
      await fetchFrom("https://wallet.example/wallet/loop", undefined, get)
    ).toBe("redirects again and again");
    await expect(
      fetchFrom("https://wallet.example/wallet/away", 2 ** 21, get)
    ).rejects.toThrow("redirects off the site");
    expect(
      await fetchFrom("https://wallet.example/wallet/gone", undefined, get)
    ).toBeNull();
  });

  it("should run npm as a script of this Node's, which on Windows a .cmd launcher can't be run without a shell", () => {
    const [command, args] = npmCommand(undefined, ["--version"]);

    expect(command).toBe(process.execPath);
    expect(execFileSync(command, args, { encoding: "utf8" })).toMatch(
      /^\d+\.\d+\.\d+\n$/
    );
    expect(npmCommand("11.18.0", ["ci"])[1].slice(1)).toEqual([
      "exec",
      "--yes",
      "--package=npm@11.18.0",
      "--",
      "npm",
      "ci",
    ]);
  });

  it("should check out every file as it was committed, whatever the machine's line endings", () => {
    const committed = execFileSync("git", [
      "cat-file",
      "blob",
      "HEAD:src/app.html",
    ]);
    const checkedOut = execFileSync("git", [
      "-c",
      "core.autocrlf=true",
      "cat-file",
      "--filters",
      "HEAD:src/app.html",
    ]);

    expect(checkedOut.equals(committed)).toBe(true);
  });
});
