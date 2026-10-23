import getAddressInfo from "$lib/wallet/getAddressInfo";

import getLensReader from "./getLensReader";

/**
 * Resolves a `.dusk` name, on mainnet and testnet only, to the public account
 * in its `moonlight_address` record and the shielded address in its
 * `phoenix_payment_endpoint` record, each taken only if it is valid. It never
 * rejects: a name that can't be paid comes back with the reason, and there is
 * no fallback.
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
    const { encodeBase58, isMoonlightEndpoint, validateName } =
      await import("@duskdomains/sdk");
    const validation = validateName(name);

    if (!validation.ok) {
      return { error: "invalid", name };
    }

    name = validation.name.canonical;

    const reader = await getLensReader(network, nodeUrl);
    const {
      records: [moonlight, phoenix],
      status,
    } = await reader.resolve(name, [
      "moonlight_address",
      "phoenix_payment_endpoint",
    ]);

    if (status !== "Active") {
      return {
        error: status === "Absent" ? "not-registered" : "expired",
        name,
      };
    }

    /** @type {DuskNameResolution} */
    const resolution = { name };

    // The reader doesn't check the public account: it must be a valid
    // compressed 96-byte BLS key, as Moonlight accounts are.
    if (moonlight && isMoonlightEndpoint(moonlight.value)) {
      resolution.account = encodeBase58(moonlight.value);
    }

    // The shielded address is stored as text, and taken only if
    // the wallet would take it as a pasted shielded address.
    if (phoenix) {
      const address = new TextDecoder().decode(Uint8Array.from(phoenix.value));

      if (getAddressInfo(address, "", "").type === "address") {
        resolution.address = address;
      }
    }

    return resolution.account || resolution.address
      ? resolution
      : { error: "no-address", name };
  } catch {
    return { error: "lookup-failed", name };
  }
}
