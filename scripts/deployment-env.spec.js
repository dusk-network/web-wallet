import { networks } from "@dusk-network/networks";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { BASE_PATH } from "../deploy/stage.js";
import { envLines } from "./deployment-env.js";
import { SITES } from "./verify-build.js";

const deployments = JSON.parse(readFileSync("deployments.json", "utf8"));
const TESTNET = SITES.testnet;

describe("Building a deployment", () => {
  it("should give a site's settings in deployments.json as lines of KEY=value, and nothing else", () => {
    for (const site of Object.values(SITES)) {
      const lines = envLines(deployments, site).split("\n");

      expect(lines.pop()).toBe("");
      expect(
        Object.fromEntries(lines.map((line) => line.split(/=(.*)/s, 2))),
      ).toEqual(deployments[site]);
      expect(lines).toContain("VITE_BASE_PATH=/wallet");
      expect(lines).toContain("VITE_MIGRATE_CONTRACT=");
      expect(lines).toEqual(lines.toSorted());
    }
  });

  it("should build each network's site for its own node, the one its file in @dusk-network/networks names, which its policy lets in", () => {
    for (const [network, site] of Object.entries(SITES)) {
      const settings = deployments[site];
      const node = new URL(
        networks[/** @type {keyof typeof networks} */ (network)].urls.node,
      ).origin;

      expect(new URL(settings.VITE_NODE_URL).origin).toBe(node);
      expect(new URL(settings.VITE_WALLET_NETWORK).origin).toBe(node);
    }

    expect(deployments[SITES.devnet].VITE_NODE_URL).toBe(
      "https://devnet.nodes.dusk.network/",
    );
  });

  it("should refuse a site deployments.json doesn't list, and a setting that isn't one line of a VITE_ one", () => {
    expect(() => envLines(deployments, TESTNET.slice(0, -1))).toThrow(
      "deployments.json doesn't list",
    );
    expect(() => envLines(deployments, "constructor")).toThrow(
      "deployments.json doesn't list",
    );

    for (const settings of [
      { NODE_OPTIONS: "--import=data:text/javascript,x" },
      { VITE_NODE_URL: "https://nodes.dusk.network/\nNODE_OPTIONS=x" },
      { "VITE_A=B": "1" },
    ]) {
      expect(() => envLines({ [TESTNET]: settings }, TESTNET)).toThrow(
        `deployments.json gives ${TESTNET} a`,
      );
    }
  });

  it("should deploy each network to a site deployments.json lists, with the build at the folder its base path names", () => {
    const { config, error } = ts.parseConfigFileTextToJson(
      "wrangler.jsonc",
      readFileSync("wrangler.jsonc", "utf8"),
    );

    expect(error).toBeUndefined();
    // Plain assets, as the explorer's: no option the account hasn't got.
    expect(config.assets).toEqual({
      binding: "ASSETS",
      directory: "./deploy/site",
    });
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);

    const sites = Object.fromEntries(
      Object.entries(config.env).map(([network, { routes }]) => {
        expect(routes).toEqual([
          { custom_domain: true, pattern: expect.any(String) },
        ]);

        return [network, `https://${routes[0].pattern}${BASE_PATH}/`];
      }),
    );

    // As the Deploy workflow deploys them and scripts/verify-build.js
    // checks them.
    expect(sites).toEqual(SITES);

    for (const site of Object.values(sites)) {
      expect(deployments[site]?.VITE_BASE_PATH).toBe(BASE_PATH);
    }
  });
});
