import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import config from "../svelte.config.js";
import { cspDirectives } from "./csp.js";

/** The settings deployments.json lists for a site. */
const settingsOf = (/** @type {string} */ site) =>
  JSON.parse(readFileSync("deployments.json", "utf8"))[site];

describe("The wallet's Content-Security-Policy", () => {
  it("should run only the wallet's own scripts, SvelteKit's inline ones by their hashes, with WebAssembly, and never be framed", () => {
    const directives = cspDirectives(
      settingsOf("https://apps.testnet.dusk.network/wallet/")
    );

    // The build's, with SvelteKit's hashes.
    expect(config.kit?.csp?.mode).toBe("hash");
    expect(config.kit?.csp?.directives?.["script-src"]).toStrictEqual([
      "self",
      "wasm-unsafe-eval",
    ]);
    expect(directives["script-src"]).toStrictEqual([
      "self",
      "wasm-unsafe-eval",
    ]);
    expect(directives["object-src"]).toStrictEqual(["none"]);
    // w3sper's WebAssembly worker, made from its own code.
    expect(directives["worker-src"]).toStrictEqual(["self", "blob:"]);
    expect(directives["base-uri"]).toStrictEqual(["self"]);
    expect(directives["frame-ancestors"]).toStrictEqual(["none"]);
    expect(Object.values(directives).flat()).not.toContain("unsafe-eval");
  });

  it("should let a build read from the node its mode's .env file names, as Vite gives it to the build's pages, and from the one it runs with over that, as deployments.json's", async () => {
    const mode = `csp-spec-${process.pid}`;
    const file = `.env.${mode}`;
    const was = {
      mode: process.env.WEB_WALLET_MODE,
      node: process.env.VITE_NODE_URL,
    };

    /** What a build in `mode` reads from: Vite's config, then SvelteKit's. */
    const connectOf = async () => {
      vi.resetModules();

      const { default: viteConfig } = await import("../vite.config.js");
      const { plugins = [] } = await /** @type {any} */ (viteConfig)({
        command: "build",
        isPreview: false,
        isSsrBuild: false,
        mode,
      });

      await Promise.all(plugins);

      const { default: built } = await import("../svelte.config.js");

      return built.kit?.csp?.directives?.["connect-src"] ?? [];
    };

    /** @param {string} name @param {string | undefined} value */
    const restore = (name, value) =>
      value === undefined
        ? delete process.env[name]
        : (process.env[name] = value);

    writeFileSync(
      file,
      "VITE_NODE_URL=https://nodes.staging.example.org:8443/\n"
    );
    // Run with none: the mode's file names it.
    delete process.env.VITE_NODE_URL;

    try {
      expect(await connectOf()).toEqual(
        expect.arrayContaining([
          "https://nodes.staging.example.org:8443",
          "wss://nodes.staging.example.org:8443",
        ])
      );

      // Run with one, as the Deploy workflow and scripts/verify-build.js run
      // a build with deployments.json's settings: that one.
      process.env.VITE_NODE_URL = "https://nodes.deploy.example.org/";

      const connect = await connectOf();

      expect(connect).toEqual(
        expect.arrayContaining([
          "https://nodes.deploy.example.org",
          "wss://nodes.deploy.example.org",
        ])
      );
      expect(connect).not.toContain("https://nodes.staging.example.org:8443");
    } finally {
      rmSync(file, { force: true });
      restore("WEB_WALLET_MODE", was.mode);
      restore("VITE_NODE_URL", was.node);
    }
  });

  it("should let a testnet build read from testnet's node, archive, prover, names, DuskEVM and the chains its routes reach, prices and WalletConnect, and nothing of mainnet's", () => {
    const connect = cspDirectives(
      settingsOf("https://apps.testnet.dusk.network/wallet/")
    )["connect-src"];

    expect(connect).toEqual(
      expect.arrayContaining([
        "self",
        "https://testnet.nodes.dusk.network",
        "wss://testnet.nodes.dusk.network",
        "https://testnet.provers.dusk.network",
        "https://testnet.dusk.domains",
        "https://rpc.testnet.evm.dusk.network",
        "https://explorer.testnet.evm.dusk.network",
        "https://anvil.testnet.dusk.network",
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://api.coingecko.com",
        "https://api.web3modal.org",
        "wss://relay.walletconnect.org",
      ])
    );
    expect(connect).not.toContain("https://nodes.dusk.network");
    expect(connect).not.toContain("https://bsc-rpc.publicnode.com");
    // Each once.
    expect(new Set(connect).size).toBe(connect.length);
  });

  it("should let a mainnet build read from mainnet's, BNB Smart Chain's and Ethereum's RPCs, and nothing of testnet's", () => {
    const connect = cspDirectives(
      settingsOf("https://apps.dusk.network/wallet/")
    )["connect-src"];

    expect(connect).toEqual(
      expect.arrayContaining([
        "https://nodes.dusk.network",
        "wss://nodes.dusk.network",
        "https://provers.dusk.network",
        "https://bsc-rpc.publicnode.com",
        "https://ethereum-rpc.publicnode.com",
      ])
    );
    expect(connect).not.toContain("https://testnet.nodes.dusk.network");
  });

  it("should let a build for a node of its own read from it, by https and WebSocket, and from what any network's file names, as it can be on any", () => {
    const connect = cspDirectives({ VITE_NODE_URL: "http://localhost:8080/" })[
      "connect-src"
    ];

    expect(connect).toEqual(
      expect.arrayContaining([
        "http://localhost:8080",
        "ws://localhost:8080",
        "https://nodes.dusk.network",
        "https://testnet.nodes.dusk.network",
      ])
    );
    expect(cspDirectives({ VITE_NODE_URL: "" })["connect-src"]).not.toContain(
      "http://localhost:8080"
    );
  });
});
