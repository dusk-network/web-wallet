import { nameDuskNames } from "@dusk-network/app-core/names";

import resolveDuskName from "./resolveDuskName";

/**
 * Whose each `.dusk` name given is, as the name service says it, for
 * app-core's checks that take `owners` (`profileNameCheck`, and
 * `readPastedLink` for a pasted request's line): its public account and
 * shielded address, or null for one that isn't registered, or has expired.
 * One it couldn't say, as where the lookup failed, is left out. Each is
 * looked up once, through `lookUp`.
 *
 * @param {string[]} names
 * @param {(name: string) => Promise<{ account?: string, address?: string, error?: string } | null>} lookUp
 * @returns {Promise<Map<string, { account?: string, address?: string } | null>>}
 */
export async function ownersOf(names, lookUp) {
  const found = await Promise.all(
    [...new Set(names)].map(async (dusk) => {
      // However the lookup fails, it says nothing of the name.
      const result = await Promise.resolve()
        .then(() => lookUp(dusk))
        .catch(() => null);

      return /** @type {const} */ ([dusk, result]);
    }),
  );

  /** @type {Map<string, { account?: string, address?: string } | null>} */
  const owners = new Map();

  for (const [dusk, result] of found) {
    if (result?.account || result?.address) {
      owners.set(dusk, { account: result.account, address: result.address });
    } else if (
      result?.error === "not-registered" ||
      result?.error === "expired"
    ) {
      owners.set(dusk, null);
    }
  }

  return owners;
}

/**
 * Whose each `.dusk` name in a name is, as `ownersOf` says it: each looked
 * up as app-core names it (`nameDuskNames`), once. One it couldn't say is
 * asked about.
 *
 * @param {string} name
 * @param {string} network The network the wallet is connected to
 * @param {string} nodeUrl The wallet's node URL for that network
 * @param {typeof resolveDuskName} [resolve]
 */
export default function nameOwners(
  name,
  network,
  nodeUrl,
  resolve = resolveDuskName,
) {
  return ownersOf(nameDuskNames(name), (dusk) =>
    resolve(dusk, network, nodeUrl),
  );
}
