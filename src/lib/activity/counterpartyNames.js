/**
 * The verified primary `.dusk` names of the history's counterparties: many
 * public accounts at once, through a lens reader whose reads go through
 * Multicall for Dusk, so up to 32 of them take one query. The reader checks
 * each answer as it checks one read alone.
 */

import { ProfileGenerator } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";
import { nameToShow } from "@duskdomains/sdk/names";
import { PINNED_RELEASES } from "@duskdomains/sdk/releases";
import { createMulticallFetch } from "@hdauven/dusk-multicall";

/** How long a kept name check is used without checking again: ten minutes. */
export const NAME_CHECK_TTL_MS = 10 * 60_000;

/**
 * The gas a lens read takes inside a multicall, as the SDK's client gives it:
 * the lens shares its gas among every read it may make and refuses when a
 * share is short.
 *
 * @type {Record<string, number>}
 */
const LENS_READS = { resolve: 90, reverse: 203 };

/**
 * @param {any} release
 * @returns {(contractId: string, fnName: string) => bigint}
 */
const lensGas = (release) => (contractId, fnName) =>
  contractId === release.lens.contractId && LENS_READS[fnName]
    ? BigInt(LENS_READS[fnName]) * 4_000_000n + 30_000_000n
    : 0n;

/** @type {Map<string, { nodeUrl: string, reader: Promise<import("@duskdomains/sdk/lens-reader").LensReader> }>} */
const readers = new Map();

/**
 * The network's batched lens reader, made on first use and again for another
 * node. One that failed to build is built again by the next lookup.
 *
 * @param {"mainnet" | "testnet"} network
 * @param {string} nodeUrl
 */
function batchedReader(network, nodeUrl) {
  const cached = readers.get(network);

  if (cached?.nodeUrl === nodeUrl) {
    return cached.reader;
  }

  const release = PINNED_RELEASES[network];
  const reader = import("@duskdomains/sdk/lens-reader").then(
    ({ createLensReader }) =>
      createLensReader(release, {
        artifactBaseUrl: release.artifactBaseUrl,
        fetch: createMulticallFetch({
          gasFor: lensGas(release),
          multicallId: networks[network].contracts.multicall,
          nodeUrl,
        }),
        nodeUrl,
      })
  );
  const entry = { nodeUrl, reader };

  readers.set(network, entry);
  reader.catch(() => {
    if (readers.get(network) === entry) {
      readers.delete(network);
    }
  });

  return reader;
}

/**
 * A lens refusal for want of gas, which a multicall's share of gas can cause
 * and a query of its own does not.
 *
 * @param {any} error
 */
const shortOfGas = (error) =>
  error?.reason === "refused" &&
  (error.refusal?.code === "GasBudget" ||
    error.refusal?.code === "ReadFailed" ||
    error.refusal?.cause === "GasBudget");

/**
 * Reads again, one at a time, the names the batch was short of gas for.
 *
 * @param {(account: string) => Uint8Array | null} decodeBase58
 * @param {"mainnet" | "testnet"} network
 * @param {string} nodeUrl
 * @param {string[]} accounts
 * @param {Map<string, string | null>} out
 */
async function readAlone(decodeBase58, network, nodeUrl, accounts, out) {
  if (!accounts.length) {
    return;
  }

  const { default: getLensReader } =
    await import("$lib/dusk-domains/getLensReader");
  const reader = await getLensReader(network, nodeUrl);

  for (const account of accounts) {
    try {
      const verified = await reader.verifyPrimary(
        Array.from(decodeBase58(account) ?? [])
      );

      out.set(account, verified === null ? null : verified.primary.spelling);
    } catch {
      // left out: looked up again next time
    }
  }
}

/**
 * The verified primary names of public accounts, for the history's
 * counterparties: the lookups go out together, so Multicall for Dusk carries
 * up to 32 of them in one query. A lookup the lens refused for want of gas
 * in the batch is made again on its own. Accounts whose lookup failed are
 * left out. Never throws.
 *
 * @param {string[]} accounts
 * @param {{ network: string, nodeUrl: string }} options
 * @returns {Promise<Map<string, string | null>>} The name of each account looked up, null for none
 */
export async function lookupCounterpartyNames(accounts, { network, nodeUrl }) {
  /** @type {Map<string, string | null>} */
  const out = new Map();
  const list = [...new Set(accounts.map((a) => String(a ?? "").trim()))].filter(
    (a) => ProfileGenerator.typeOf(a) === "account"
  );

  if ((network !== "mainnet" && network !== "testnet") || !list.length) {
    return out;
  }

  try {
    const reader = await batchedReader(network, nodeUrl);
    const { decodeBase58 } = await import("@duskdomains/sdk/lens-reader");

    // Started in one task, so one aggregate takes them.
    const results = await Promise.allSettled(
      list.map((a) => reader.verifyPrimary(Array.from(decodeBase58(a) ?? [])))
    );

    /** @type {string[]} */
    const again = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        out.set(list[i], result.value?.primary.spelling ?? null);
      } else if (shortOfGas(result.reason)) {
        again.push(list[i]);
      }
    });

    await readAlone(decodeBase58, network, nodeUrl, again, out);

    // As the history shows them: whole, and none that reads like a key.
    for (const [account, name] of out) {
      out.set(account, name === null ? null : nameToShow(name));
    }
  } catch {
    // whatever was looked up so far
  }

  return out;
}
