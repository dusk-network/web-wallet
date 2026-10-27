import makeNodeUrl from "./makeNodeUrl";

/**
 * The node's base URL, which the wallet's requests to it start from: its
 * origin and the base path it is configured with (`VITE_RUSK_PATH`, or a
 * path in `VITE_NODE_URL`), without a trailing slash.
 *
 * @returns {string}
 */
export default function nodeBaseUrl() {
  return makeNodeUrl().href.replace(/\/+$/, "");
}
