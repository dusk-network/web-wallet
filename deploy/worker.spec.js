import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as module from "./worker.js";
import worker, { HEADERS } from "./worker.js";

const EXPLORER = "https://explorer.testnet.dusk.network";
const PAGE = "<!doctype html><title>Dusk Web Wallet</title>";

/**
 * The Worker's answer at a path of apps.testnet.dusk.network, with what it
 * asked the build's files for: they have the wallet's page at /wallet/ alone.
 *
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {{ ANDROID_CERTS?: string }} [vars] The environment's, but EXPLORER
 */
const ask = async (path, init, vars = {}) => {
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
    { ASSETS, EXPLORER, ...vars }
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
  it("should export only what Cloudflare runs a Worker by: handlers and objects, no other value", () => {
    for (const [name, value] of Object.entries(module)) {
      expect([name, typeof value]).toEqual([
        name,
        expect.stringMatching(/^(function|object)$/),
      ]);
    }
  });

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

  it("should name the Dusk Wallet app signed with the environment's certificates at the domain's root, for Android to open the wallet's links in it, and no app where it names none", async () => {
    const TEST_KEY =
      "2B:F9:B8:C1:BD:0D:D3:AE:19:70:5F:E0:CF:C5:54:21:CF:49:68:D3:AA:AF:3B:6D:35:2B:49:D7:65:CA:3D:A6";
    const RELEASE_KEY =
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
    const { asked, response } = await ask(
      "/.well-known/assetlinks.json",
      undefined,
      { ANDROID_CERTS: `${TEST_KEY}, ${RELEASE_KEY}` }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toStrictEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "network.dusk.wallet",
          sha256_cert_fingerprints: [TEST_KEY, RELEASE_KEY],
        },
      },
    ]);
    expect(asked).toEqual([]);

    // Asked as Android's checker may ask.
    const head = await ask(
      "/.well-known/assetlinks.json",
      { method: "HEAD" },
      {
        ANDROID_CERTS: TEST_KEY,
      }
    );

    expect(head.response.status).toBe(200);
    expect(await head.response.text()).toBe("");

    // Mainnet's, before the release key: none, so no app opens its links.
    for (const vars of [{}, { ANDROID_CERTS: "" }, { ANDROID_CERTS: " , " }]) {
      const none = await ask("/.well-known/assetlinks.json", undefined, vars);

      expect(none.response.status).toBe(404);
      expectOwnAnswer(none.response);
    }

    // Only at the root.
    expect(
      (
        await ask("/wallet/.well-known/assetlinks.json", undefined, {
          ANDROID_CERTS: TEST_KEY,
        })
      ).asked
    ).toHaveLength(1);
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

  it("should give its own answers the headers deploy/headers gives every file, with a policy that lets nothing in, as they're no pages", () => {
    const rules = readFileSync("deploy/headers", "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .join("\n")
      .split(/^(?=\/)/m)
      .map((rule) => rule.trim().split("\n"));
    const every = Object.fromEntries(
      (rules.find(([path]) => path === "/*")?.slice(1) ?? []).map((line) =>
        line.trim().split(/: (.*)/s, 2)
      )
    );

    expect(every["Content-Security-Policy"]).toBe("PAGE_POLICY");
    expect({
      ...every,
      "Content-Security-Policy": HEADERS["Content-Security-Policy"],
    }).toEqual(HEADERS);
    expect(HEADERS["Content-Security-Policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'"
    );
  });
});
