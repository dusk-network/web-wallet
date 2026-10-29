import { PINNED_RELEASES } from "@duskdomains/sdk/releases";

/** @type {Map<string, Promise<import("@duskdomains/sdk/lens-reader").LensReader>>} */
const readers = new Map();

/**
 * Returns the network's lens reader, created on first use from the pinned
 * release. It fetches only the lens driver, from the Dusk Domains site, and
 * uses it once it matches the pinned digests. A failed creation is dropped,
 * so the next lookup retries. The reader is imported only then, in its own
 * chunk.
 *
 * @param {"mainnet" | "testnet"} network
 * @param {string} nodeUrl
 */
export default function getLensReader(network, nodeUrl) {
  let reader = readers.get(network);

  if (!reader) {
    const release = PINNED_RELEASES[network];

    reader = import("@duskdomains/sdk/lens-reader").then(
      ({ createLensReader }) =>
        createLensReader(release, {
          artifactBaseUrl: release.artifactBaseUrl,
          nodeUrl,
        })
    );
    readers.set(network, reader);
    reader.catch(() => readers.delete(network));
  }

  return reader;
}
