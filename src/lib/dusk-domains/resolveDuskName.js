import getAddressInfo from "$lib/wallet/getAddressInfo";

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
 * What a name's records pay to: the public account in its
 * `moonlight_address` record and the shielded address in its
 * `phoenix_payment_endpoint` record, each where it's valid.
 *
 * @param {string} name
 * @param {({ value: number[] } | null)[]} records
 * @param {typeof import("@duskdomains/sdk")} sdk
 * @returns {DuskNameResolution}
 */
function paidTo(name, [moonlight, phoenix], sdk) {
  /** @type {DuskNameResolution} */
  const resolution = { name };

  // The reader doesn't check the public account: it must be a valid
  // compressed 96-byte BLS key, as Moonlight accounts are.
  if (moonlight && sdk.isMoonlightEndpoint(moonlight.value)) {
    resolution.account = sdk.encodeBase58(moonlight.value);
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
}

/**
 * One lookup of a name: "lookup-failed" when it couldn't be made.
 *
 * @param {string} input
 * @param {"mainnet" | "testnet"} network
 * @param {string} nodeUrl
 * @returns {Promise<DuskNameResolution>}
 */
async function lookUp(input, network, nodeUrl) {
  let name = input;

  try {
    const sdk = await import("@duskdomains/sdk");
    const validation = sdk.validateName(name);

    if (!validation.ok) {
      return { error: "invalid", name };
    }

    name = validation.name.canonical;

    const reader = await getLensReader(network, nodeUrl);
    const { records, status } = await reader.resolve(name, [
      "moonlight_address",
      "phoenix_payment_endpoint",
    ]);

    if (status !== "Active") {
      return {
        error: status === "Absent" ? "not-registered" : "expired",
        name,
      };
    }

    return paidTo(name, records, sdk);
  } catch {
    return { error: "lookup-failed", name };
  }
}
