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
function getReader(network, nodeUrl) {
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

/**
 * Resolves a `.dusk` name to the public account in its `moonlight_address`
 * record, on mainnet and testnet only. It never rejects: a name that can't
 * be paid comes back with the reason, and there is no fallback.
 *
 * @param {string} input The recipient as entered, ending in `.dusk`.
 * @param {string} network The network the wallet is connected to.
 * @param {string} nodeUrl The wallet's node URL for that network.
 * @returns {Promise<DuskNameResolution>}
 */
export default async function resolveDuskName(input, network, nodeUrl) {
  let name = input.trim();

  if (network !== "mainnet" && network !== "testnet") {
    return { error: "unsupported-network", name };
  }

  try {
    const { decodeBase58, isMoonlightEndpoint, validateName } =
      await import("@duskdomains/sdk");
    const validation = validateName(name);

    if (!validation.ok) {
      return { error: "invalid", name };
    }

    name = validation.name.canonical;

    const reader = await getReader(network, nodeUrl);
    const { account, status } = await reader.resolveMoonlightAccount(name);

    if (status !== "Active") {
      return {
        error: status === "Absent" ? "not-registered" : "expired",
        name,
      };
    }

    // The reader checks only the key's shape: check it is a valid compressed
    // 96-byte BLS key too, as Moonlight accounts are.
    return account && isMoonlightEndpoint(decodeBase58(account) ?? [])
      ? { address: account, name }
      : { error: "no-address", name };
  } catch {
    return { error: "lookup-failed", name };
  }
}
