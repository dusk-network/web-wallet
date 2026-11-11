/**
 * The wallet's Worker on Cloudflare (wrangler.jsonc). Its files are served
 * from deploy/site/, the build at wallet/, with the headers in
 * deploy/site/_headers, and this runs only for a request no file answers.
 */

/** The headers deploy/site/_headers gives every file, for its own answers. */
export const HEADERS = Object.freeze({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

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
   * @param {{ ASSETS: { fetch: typeof fetch }, EXPLORER: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = pathOf(url);

    if (!["GET", "HEAD"].includes(request.method)) {
      return answer(405, { Allow: "GET, HEAD" });
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
