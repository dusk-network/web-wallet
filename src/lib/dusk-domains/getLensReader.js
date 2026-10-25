/** @type {Map<string, Promise<import("@duskdomains/sdk/lens-reader").LensReader>>} */
const readers = new Map();

/**
 * Returns the network's lens reader, created on first use from the pinned
 * release. It fetches only the lens driver, from the Dusk Domains site, and
 * uses it once it matches the pinned digests. A failed creation is dropped,
 * so the next lookup retries. The reader and the releases are imported only
 * then, in their own chunks.
 *
 * @param {"mainnet" | "testnet"} network
 * @param {string} nodeUrl
 */
export default function getLensReader(network, nodeUrl) {
  let reader = readers.get(network);

  if (!reader) {
    reader = Promise.all([
      import("@duskdomains/sdk/lens-reader"),
      import("./dusk-domains-releases.json"),
    ]).then(([{ createLensReader }, { default: releases }]) =>
      createLensReader(releases[network], {
        artifactBaseUrl: releases[network].artifactBaseUrl,
        nodeUrl,
      })
    );
    readers.set(network, reader);
    reader.catch(() => readers.delete(network));
  }

  return reader;
}
