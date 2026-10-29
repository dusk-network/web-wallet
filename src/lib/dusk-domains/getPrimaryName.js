import getLensReader from "./getLensReader";
import resolveDuskName from "./resolveDuskName";
import { keepVerifiedName } from "./verifiedNames";

/** How long a lookup is reused, in milliseconds: a minute. */
const MAX_AGE = 60_000;

/** @type {Map<string, { expiresAt: number, name: Promise<string> }>} */
const lookups = new Map();

/**
 * Looks a name up, unless it was looked up under the same key less
 * than a minute ago. A lookup that fails isn't kept.
 *
 * @param {string} key
 * @param {() => Promise<string>} lookUp
 * @returns {Promise<string>}
 */
function reuse(key, lookUp) {
  const kept = lookups.get(key);

  if (kept && kept.expiresAt > Date.now()) {
    return kept.name;
  }

  const name = lookUp();

  lookups.set(key, { expiresAt: Date.now() + MAX_AGE, name });
  name.catch(() => {
    if (lookups.get(key)?.name === name) {
      lookups.delete(key);
    }
  });

  return name;
}

/**
 * The `.dusk` name to show with one of the wallet's own addresses, on mainnet
 * and testnet only: the verified primary name of its public account, or ""
 * when it has none. With the shielded address, it is that name only if the
 * name's `phoenix_payment_endpoint` record is that address, so a name is never
 * shown with an address it doesn't pay to. A lookup is reused for a minute,
 * per network and address; one that fails rejects, and is made again the next
 * time. The outcome of a public account's lookup is kept, see
 * `getVerifiedName`.
 *
 * @param {string} account The public account, in Base58.
 * @param {string} network The network the wallet is connected to.
 * @param {string} nodeUrl The wallet's node URL for that network.
 * @param {string} [shieldedAddress] The account's shielded address, when the name is shown with that instead.
 * @returns {Promise<string>}
 */
export default function getPrimaryName(
  account,
  network,
  nodeUrl,
  shieldedAddress
) {
  if (network !== "mainnet" && network !== "testnet") {
    return Promise.resolve("");
  }

  if (shieldedAddress) {
    return reuse(`${network} ${account} ${shieldedAddress}`, async () => {
      const name = await getPrimaryName(account, network, nodeUrl);

      if (!name) {
        return "";
      }

      const { address, error } = await resolveDuskName(name, network, nodeUrl);

      if (error === "lookup-failed") {
        throw new Error(`Couldn't look up ${name}`);
      }

      return address === shieldedAddress ? name : "";
    });
  }

  return reuse(`${network} ${account}`, async () => {
    const reader = await getLensReader(network, nodeUrl);
    const { decodeBase58 } = await import("@duskdomains/sdk/lens-reader");

    // The lens takes the key as plain bytes.
    const primary = await reader.verifyPrimary(
      Array.from(decodeBase58(account) ?? [])
    );
    const name = primary?.primary.spelling ?? "";

    keepVerifiedName(network, account, name);

    return name;
  });
}
