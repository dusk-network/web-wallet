/**
 * The wallet's Worker on Cloudflare (wrangler.jsonc). Its files are served
 * from deploy/site/, the build at wallet/, with the headers deploy/stage.js
 * writes in deploy/site/_headers, and this runs only for a request no file
 * answers:
 * the wallet's page at an address of its own, the explorer's old addresses,
 * and the Android app's links' statement at the domain's root.
 */

/**
 * The headers deploy/headers gives every file, for its own answers: but the
 * policy, as none of them is a page, so none needs a source of any kind.
 */
export const HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

/**
 * The Dusk Wallet app on Android, which can open the wallet's links. Not
 * exported: a Worker's module exports only what Cloudflare runs.
 */
const ANDROID_APP = "network.dusk.wallet";

/**
 * Who may open this domain's links, as Android verifies its App Links: the
 * Dusk Wallet app, signed with one of `certs` (SHA-256 fingerprints).
 *
 * @param {string[]} certs
 */
const assetLinks = (certs) => [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ANDROID_APP,
      sha256_cert_fingerprints: certs,
    },
  },
];

/**
 * An answer with no body, never cached.
 *
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
const answer = (status, headers = {}) =>
  new Response(null, {
    headers: { ...HEADERS, "Cache-Control": "no-store", ...headers },
    status,
  });

/**
 * A request's path as the files are looked up by: decoded, with no empty
 * folder in it.
 *
 * @param {URL} url
 */
const pathOf = (url) => {
  try {
    return decodeURIComponent(url.pathname).replace(/\/+/g, "/");
  } catch {
    return url.pathname;
  }
};

export default {
  /**
   * @param {Request} request
   * @param {{ ANDROID_CERTS?: string, ASSETS: { fetch: typeof fetch }, EXPLORER: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = pathOf(url);

    if (!["GET", "HEAD"].includes(request.method)) {
      return answer(405, { Allow: "GET, HEAD" });
    }

    // The Dusk Wallet app may open the wallet's links, as Android checks at
    // the domain's root, where its signing certificates are named
    // (wrangler.jsonc): without one, no app does.
    if (path === "/.well-known/assetlinks.json") {
      const certs = (env.ANDROID_CERTS ?? "")
        .split(",")
        .map((cert) => cert.trim())
        .filter(Boolean);

      return certs.length
        ? new Response(
            request.method === "HEAD"
              ? null
              : JSON.stringify(assetLinks(certs)),
            {
              headers: {
                ...HEADERS,
                "Cache-Control": "public, max-age=3600",
                "Content-Type": "application/json",
              },
            }
          )
        : answer(404);
    }

    // Where the explorer was, sent to its own domain as DigitalOcean did:
    // the explorer takes its old addresses from there.
    if (/^\/explorer(\/|$)/.test(path)) {
      return answer(302, {
        Location: `${env.EXPLORER}${url.pathname}${url.search}`,
      });
    }

    // An address of the wallet's that no page has opens the wallet, which says
    // what's there. Not under _app/, the build's scripts, styles and version:
    // one that isn't there is missing, and is never answered with a page.
    if (path.startsWith("/wallet/") && !/^\/wallet\/_app(\/|$)/.test(path)) {
      return env.ASSETS.fetch(new URL("/wallet/", url), {
        headers: request.headers,
        method: request.method,
      });
    }

    return answer(404);
  },
};
