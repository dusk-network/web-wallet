import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import worker, { HEADERS } from "./worker.js";

const EXPLORER = "https://explorer.testnet.dusk.network";
const PAGE = "<!doctype html><title>Dusk Web Wallet</title>";

/**
 * The Worker's answer at a path of apps.testnet.dusk.network, with what it
 * asked the build's files for: they have the wallet's page at /wallet/ alone.
 *
 * @param {string} path
 * @param {RequestInit} [init]
 */
const ask = async (path, init) => {
  /** @type {{ headers: Headers, method?: string, url: string }[]} */
  const asked = [];
  const ASSETS = {
    fetch: async (
      /** @type {URL} */ url,
      /** @type {RequestInit} */ { headers, method } = {}
    ) => {
      asked.push({ headers: new Headers(headers), method, url: String(url) });

      return new URL(url).pathname === "/wallet/"
        ? new Response(method === "HEAD" ? null : PAGE, {
            headers: { "Content-Type": "text/html" },
          })
        : new Response(null, { status: 404 });
    },
  };
  const response = await worker.fetch(
    new Request(`https://apps.testnet.dusk.network${path}`, init),
    // @ts-ignore: the binding's fetch, as far as the Worker uses it
    { ASSETS, EXPLORER }
  );

  return { asked, response };
};

/** @param {Response} response */
const expectOwnAnswer = (response) => {
  for (const [name, value] of Object.entries(HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }

  expect(response.headers.get("Cache-Control")).toBe("no-store");
};

describe("The wallet's Worker", () => {
  it("should open the wallet's page at an address of its own that no file has, as asked", async () => {
    for (const path of [
      "/wallet/does/not/exist",
      "/wallet/dashboard/gone/",
      "/wallet//setup",
      "/wallet/_application",
    ]) {
      const { asked, response } = await ask(path);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(PAGE);
      expect(asked).toMatchObject([
        { method: "GET", url: "https://apps.testnet.dusk.network/wallet/" },
      ]);
    }

    const { asked, response } = await ask("/wallet/gone?x=1", {
      headers: { "If-None-Match": '"abc"' },
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(asked).toHaveLength(1);
    expect(asked[0].method).toBe("HEAD");
    expect(asked[0].url).toBe("https://apps.testnet.dusk.network/wallet/");
    expect(asked[0].headers.get("If-None-Match")).toBe('"abc"');
  });

  it("should say a file under _app/ that isn't there is missing, never with a page, and have it cached nowhere", async () => {
    for (const path of [
      "/wallet/_app/immutable/chunks/gone.js",
      "/wallet/_app/immutable/",
      "/wallet/_app",
      "/wallet/%5Fapp/immutable/chunks/gone.js",
      "/wallet//_app/version.json",
    ]) {
      const { asked, response } = await ask(path);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(asked).toEqual([]);
      expectOwnAnswer(response);
    }
  });

  it("should send what was the explorer's on to its own domain, with the rest of the address", async () => {
    for (const [path, location] of [
      ["/explorer", `${EXPLORER}/explorer`],
      ["/explorer/", `${EXPLORER}/explorer/`],
      ["/explorer/blocks?x=1", `${EXPLORER}/explorer/blocks?x=1`],
    ]) {
      const { response } = await ask(path);

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(location);
      expectOwnAnswer(response);
    }

    expect((await ask("/explorers")).response.status).toBe(404);
  });

  it("should answer anything else with a 404, and nothing but GET and HEAD", async () => {
    for (const path of ["/", "/foo", "/WALLET/", "/walletx/"]) {
      const { asked, response } = await ask(path);

      expect(response.status).toBe(404);
      expect(asked).toEqual([]);
      expectOwnAnswer(response);
    }

    for (const path of ["/wallet/gone", "/explorer", "/"]) {
      const { asked, response } = await ask(path, { method: "POST" });

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
      expect(asked).toEqual([]);
      expectOwnAnswer(response);
    }
  });

  it("should give its own answers the headers deploy/site/_headers gives every file", () => {
    const rules = readFileSync("deploy/site/_headers", "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .join("\n")
      .split(/^(?=\/)/m)
      .map((rule) => rule.trim().split("\n"));
    const every = rules.find(([path]) => path === "/*")?.slice(1) ?? [];

    expect(
      Object.fromEntries(every.map((line) => line.trim().split(/: (.*)/s, 2)))
    ).toEqual(HEADERS);
  });
});
