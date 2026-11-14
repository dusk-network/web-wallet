import { nameDuskNames } from "@dusk-network/app-core/names";

import resolveDuskName from "./resolveDuskName";

/**
 * Whose each `.dusk` name in a name is, as the name service says it, for
 * app-core's profileNameCheck (`owners`): its public account and shielded
 * address, or null for one that isn't registered, or has expired. One it
 * couldn't say, as where the lookup failed, is left out: it's asked about.
 * Each is looked up as app-core names it (`nameDuskNames`), once.
 *
 * @param {string} name
 * @param {string} network The network the wallet is connected to
 * @param {string} nodeUrl The wallet's node URL for that network
 * @param {typeof resolveDuskName} [resolve]
 * @returns {Promise<Map<string, { account?: string, address?: string } | null>>}
 */
export default async function nameOwners(
  name,
  network,
  nodeUrl,
  resolve = resolveDuskName
) {
  const found = await Promise.all(
    nameDuskNames(name).map(async (dusk) => {
      const result = await resolve(dusk, network, nodeUrl).catch(() => null);

      return /** @type {const} */ ([dusk, result]);
    })
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
