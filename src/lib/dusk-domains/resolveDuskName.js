import { validateName } from "@duskdomains/sdk/names";

import getLensReader from "./getLensReader";

/**
 * Resolves a `.dusk` name, on mainnet and testnet only, to the public account
 * in its `moonlight_address` record and the shielded address in its
 * `phoenix_payment_endpoint` record, each taken only if it is valid. It never
 * rejects: a name that can't be paid comes back with the reason, and there is
 * no fallback.
 *
 * A lookup that fails is made once more before it reads as one: the first
 * after unlocking can fail while the names' reader is still loading.
 *
 * @param {string} input The recipient as entered, ending in `.dusk`.
 * @param {string} network The network the wallet is connected to.
 * @param {string} nodeUrl The wallet's node URL for that network.
 * @returns {Promise<DuskNameResolution>}
 */
export default async function resolveDuskName(input, network, nodeUrl) {
  const name = input.trim();

  if (network !== "mainnet" && network !== "testnet") {
    return { error: "unsupported-network", name };
  }

  const first = await lookUp(name, network, nodeUrl);

  return first.error === "lookup-failed"
    ? lookUp(name, network, nodeUrl)
    : first;
}

/**
 * One lookup of a name: "lookup-failed" when it couldn't be made. What it
 * pays to is what `resolveAccounts` reads: the public account in its
 * `moonlight_address` record where that's a valid key, and the shielded
 * address in its `phoenix_payment_endpoint` record where it's exactly one.
 *
 * @param {string} input
 * @param {"mainnet" | "testnet"} network
 * @param {string} nodeUrl
 * @returns {Promise<DuskNameResolution>}
 */
async function lookUp(input, network, nodeUrl) {
  const validation = validateName(input);

  if (!validation.ok) {
    return { error: "invalid", name: input };
  }

  const name = validation.name.canonical;

  try {
    const [{ resolveAccounts }, reader] = await Promise.all([
      import("@duskdomains/sdk/accounts"),
      getLensReader(network, nodeUrl),
    ]);
    const { account, address, status } = await resolveAccounts(reader, name);

    if (status !== "Active") {
      return {
        error: status === "Absent" ? "not-registered" : "expired",
        name,
      };
    }

    return account || address
      ? {
          ...(account ? { account } : {}),
          ...(address ? { address } : {}),
          name,
        }
      : { error: "no-address", name };
  } catch {
    return { error: "lookup-failed", name };
  }
}
