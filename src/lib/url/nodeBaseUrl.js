import makeNodeUrl from "./makeNodeUrl";

/**
 * The node's base URL, which the wallet's requests to it start from: its
 * origin and the base path it is configured with (`VITE_RUSK_PATH`, or a
 * path in `VITE_NODE_URL`), without a trailing slash. It is built from the
 * node's root: a node URL left empty is the page's origin, never the URL
 * of the module that builds it.
 *
 * @returns {string}
 */
export default function nodeBaseUrl() {
  return makeNodeUrl("/").href.replace(/\/+$/, "");
}
