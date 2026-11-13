import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { modeOf } from "./build.js";
import {
  REPOSITORY,
  attestationArgs,
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

  it("should take one redirect alone, from a page's address without its last slash, or its index.html, to the page's", async () => {
    const page = "<!doctype html>";
    const redirect = (/** @type {string} */ location, status = 301) =>
      new Response(null, { headers: { location }, status });
    /** @type {Record<string, () => Response>} */
    const served = {
      "https://wallet.example/wallet/_app/x.js": () =>
        redirect("/elsewhere/x.js"),
      "https://wallet.example/wallet/away": () =>
        redirect("https://elsewhere.example/wallet/away/"),
      "https://wallet.example/wallet/build-manifest.json": () =>
        redirect("/wallet/elsewhere.json"),
      "https://wallet.example/wallet/cached": () =>
        redirect("/wallet/cached/", 304),
      "https://wallet.example/wallet/cached/": () => new Response(page),
      "https://wallet.example/wallet/elsewhere/x.js": () => new Response("x"),
      "https://wallet.example/wallet/other": () => redirect("/wallet/setup/"),
      "https://wallet.example/wallet/other/index.html": () =>
        redirect("/wallet/setup/", 307),
      "https://wallet.example/wallet/setup": () => redirect("/wallet/setup/"),
      "https://wallet.example/wallet/setup/": () => new Response(page),
      "https://wallet.example/wallet/setup/index.html": () =>
        redirect("/wallet/setup/", 307),
      "https://wallet.example/wallet/twice": () => redirect("twice/", 308),
      "https://wallet.example/wallet/twice/": () => redirect("/wallet/setup/"),
    };
    const get = async (/** @type {string} */ address) =>
      served[address]?.() ?? new Response(null, { status: 404 });
    const at = (/** @type {string} */ path, /** @type {string} */ to = "") =>
      fetchFrom(`https://wallet.example/wallet/${path}`, {
        get,
        to: to && `https://wallet.example/wallet/${to}`,
      });

    expect(await at("setup", "setup/")).toBe(
      createHash("sha256").update(page).digest("hex")
    );
    expect(await at("setup/index.html", "setup/")).toBe(
      createHash("sha256").update(page).digest("hex")
    );
    expect(await at("setup")).toBe("a redirect");
    expect(await at("setup/index.html")).toBe("a redirect");
    expect(await at("_app/x.js")).toBe("a redirect");
    expect(await at("other", "other/")).toBe("a redirect");
    expect(await at("other/index.html", "other/")).toBe("a redirect");
    expect(await at("away", "away/")).toBe("a redirect");
    expect(await at("twice", "twice/")).toBe("a redirect");
    expect(await at("cached", "cached/")).toBeNull();
    expect(await at("gone", "gone/")).toBeNull();
    await expect(
      fetchFrom("https://wallet.example/wallet/build-manifest.json", {
        get,
        limit: 2 ** 21,
      })
    ).rejects.toThrow("redirects /wallet/build-manifest.json");
  });

  it("should ask once more where the connection failed, as one kept open while the rebuild ran can have been closed", async () => {
    const page = "<!doctype html>";
    let failures = 1;
    const get = vi.fn(async () => {
      if (failures-- > 0) throw new TypeError("fetch failed");

      return new Response(page);
    });

    expect(await fetchFrom("https://wallet.example/wallet/", { get })).toBe(
      createHash("sha256").update(page).digest("hex")
    );
    expect(get).toHaveBeenCalledTimes(2);

    failures = 2;
    get.mockClear();
    await expect(
      fetchFrom("https://wallet.example/wallet/", { get })
    ).rejects.toThrow("fetch failed");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("should catch a script that redirects, whose own imports a browser would fetch from where it lands", async () => {
    const digest = (/** @type {string} */ text) =>
      createHash("sha256").update(text).digest("hex");
    const bodies = {
      "_app/immutable/chunks/-dNcaVtT.js": 'import"./B6-Q-Emf.js";',
      "index.html": "<!doctype html>",
    };
    const files = new Map(
      Object.entries(bodies).map(([path, body]) => [path, digest(body)])
    );
    /** @type {Record<string, () => Response>} */
    const served = {
      "https://wallet.example/elsewhere/-dNcaVtT.js": () =>
        new Response(bodies["_app/immutable/chunks/-dNcaVtT.js"]),
      "https://wallet.example/wallet": () =>
        new Response(null, { headers: { location: "/wallet/" }, status: 301 }),
      "https://wallet.example/wallet/": () =>
        new Response(bodies["index.html"]),
      "https://wallet.example/wallet/_app/immutable/chunks/-dNcaVtT.js": () =>
        new Response(null, {
          headers: { location: "/elsewhere/-dNcaVtT.js" },
          status: 302,
        }),
      "https://wallet.example/wallet/index.html": () =>
        new Response(bodies["index.html"]),
    };
    const get = async (/** @type {string} */ address) =>
      served[address]?.() ?? new Response(null, { status: 404 });
    const { differences } = await compareSite(SITE, files, files, (at, to) =>
      fetchFrom(at, { get, to })
    );

    expect(differences).toMatchObject([
      {
        address:
          "https://wallet.example/wallet/_app/immutable/chunks/-dNcaVtT.js",
        served: "a redirect",
      },
    ]);
  });

  it("should take a site on Cloudflare, which sends a page's index.html, and its address without the slash, on to the page", async () => {
    const digest = (/** @type {string} */ text) =>
      createHash("sha256").update(text).digest("hex");
    const bodies = {
      "_app/immutable/chunks/-dNcaVtT.js": 'import"./B6-Q-Emf.js";',
      "index.html": "<!doctype html>",
      "setup/index.html": "<!doctype html><title>Setup</title>",
    };
    const files = new Map(
      Object.entries(bodies).map(([path, body]) => [path, digest(body)])
    );
    const redirect = (/** @type {string} */ location) => () =>
      new Response(null, { headers: { location }, status: 307 });
    /** @type {Record<string, () => Response>} */
    const served = {
      "https://wallet.example/wallet": redirect("/wallet/"),
      "https://wallet.example/wallet/": () =>
        new Response(bodies["index.html"]),
      "https://wallet.example/wallet/_app/immutable/chunks/-dNcaVtT.js": () =>
        new Response(bodies["_app/immutable/chunks/-dNcaVtT.js"]),
      "https://wallet.example/wallet/index.html": redirect("/wallet/"),
      "https://wallet.example/wallet/setup": redirect("/wallet/setup/"),
      "https://wallet.example/wallet/setup/": () =>
        new Response(bodies["setup/index.html"]),
      "https://wallet.example/wallet/setup/index.html":
        redirect("/wallet/setup/"),
    };
    const get = async (/** @type {string} */ address) =>
      served[address]?.() ?? new Response(null, { status: 404 });
    const compare = () =>
      compareSite(SITE, files, files, (at, to) => fetchFrom(at, { get, to }));

    expect(await compare()).toEqual({ checked: 7, differences: [] });

    // Sent anywhere but to its own page, it's not the page.
    served["https://wallet.example/wallet/setup/index.html"] =
      redirect("/wallet/");

    expect((await compare()).differences).toMatchObject([
      {
        address: "https://wallet.example/wallet/setup/index.html",
        served: "a redirect",
      },
    ]);
  });

  it("should run npm from its own script, as this Node, where it's beside it, and from the PATH otherwise", () => {
    const ci = ["exec", "--yes", "--package=npm@11.18.0", "--", "npm", "ci"];
    const beside = "/node/lib/node_modules/npm/bin/npm-cli.js";

    expect(npmCommand("11.18.0", ["ci"], beside)).toEqual([
      process.execPath,
      [beside, ...ci],
    ]);
    expect(npmCommand("11.18.0", ["ci"], null)).toEqual(["npm", ci]);
    expect(npmCommand(undefined, ["run", "build"], null)).toEqual([
      "npm",
      ["run", "build"],
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

  it("should check with GitHub that its Deploy workflow attested a site's manifest, as served, built from the commit it names on GitHub's own runners", () => {
    expect(REPOSITORY).toBe("dusk-network/web-wallet");
    expect(attestationArgs("/tmp/build-manifest.json", COMMIT)).toStrictEqual([
      "attestation",
      "verify",
      "/tmp/build-manifest.json",
      "--repo",
      "dusk-network/web-wallet",
      "--signer-workflow",
      "dusk-network/web-wallet/.github/workflows/deploy.yml",
      "--source-digest",
      COMMIT,
      "--deny-self-hosted-runners",
    ]);
  });

  it("should have the Deploy workflow attest the manifest it builds, with GitHub's identity for it, before anything is deployed", () => {
    const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
    const at = (/** @type {string} */ text) => workflow.indexOf(text);

    expect(workflow).toMatch(
      /uses: actions\/attest-build-provenance@[0-9a-f]{40} # v\d/
    );
    expect(workflow).toMatch(/subject-path: build\/build-manifest\.json\n/);
    expect(workflow).toMatch(/\n {6}attestations: write\n/);
    expect(workflow).toMatch(/\n {6}id-token: write\n/);
    expect(at("run: npm run build")).toBeLessThan(
      at("actions/attest-build-provenance")
    );
    expect(at("actions/attest-build-provenance")).toBeLessThan(
      at("wrangler deploy")
    );
  });
});
