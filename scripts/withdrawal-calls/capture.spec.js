/**
 * What this checkout's DuskEVM withdrawals hand the wallet to sign, for
 * user2's real testnet withdrawals, read from testnet: the wallet is stubbed
 * to record what it's handed, and never signs or sends.
 *
 * - each withdrawal's status, as the tracking keeps it;
 * - the proof where one can be made now, and its claim date;
 * - the claim where one can be made now, and the claims of withdrawals
 *   their provers can claim now, signed as them;
 * - the claim dates History reads, the waits, and a withdrawal's start.
 *
 * Not run in CI. `compare.js` runs it here and in another checkout at once,
 * then compares the two, byte for byte.
 */

import { expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, dataDrivers } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";
import { evmAddressOf } from "@dusk-network/networks/duskevm";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { fetchWithdrawalActivity } from "$lib/bridge/blockscoutWithdrawalActivity";
import {
  getRememberedWithdrawalTransaction,
  rememberWithdrawalTransaction,
} from "$lib/bridge/withdrawalActivityStorage";
import { refreshWithdrawalTransaction } from "$lib/bridge/withdrawalTracking";
import * as withdrawals from "$lib/bridge/withdrawals";

/** user2's public account, which proves and claims. */
const ACCOUNT =
  process.env.CAPTURE_ACCOUNT ??
  "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz";

/** The DuskEVM addresses user2's withdrawals were sent from. */
const SENDERS = (
  process.env.CAPTURE_SENDERS ??
  [
    "0xc11d5aab4234e255e214ac6e8c0ad61fa0836473",
    "0x784053019bd07a6444779f3b1094f15b1bac4eac",
    "0x5b18c80c82246e3ca49d340ada0cdb8bcf7e5425",
  ].join(",")
).split(",");

/**
 * user2's withdrawals the package's vectors were recorded from (app-core's
 * test/fixtures/duskevm-withdrawal-vectors.json), wherever they were sent.
 */
const VECTORS = (
  process.env.CAPTURE_TXS ??
  [
    "0x04a8a8977dd251da49bd8997cf4d063ddc385f8d29b437b119bb3c79c11b3213",
    "0x6ae8c4cbf54f2fe2edfa881a3f24d82ba46f735707f6f9ef7ff591963574b38f",
    "0x517fe1a2b949b9cc23ff9bb3b3acc77d256bed937c88b647b7bebd13d02b510c",
    "0xa6aab6def93aacb94c0e902fcbdaa613416d0a39ecade5eb2588f8b7046e60ff",
    "0xf1cd875814002f134c3eceabbb9d950c4483103bed48e3bfd0007bdc4d6d2b52",
    "0x1ce1428886482020f11c3084e5551860482ece6d0db714b546e1a30f5f957e38",
  ].join(",")
).split(",");

/** Withdrawals of user2's that their provers can claim now: by hash, the prover. */
const PROVERS = {
  "0x04a8a8977dd251da49bd8997cf4d063ddc385f8d29b437b119bb3c79c11b3213":
    "0x919400d7283dad09a4907586403f22faacb36449",
  "0x1ce1428886482020f11c3084e5551860482ece6d0db714b546e1a30f5f957e38":
    "0xc31891b7499c266302fbed497ab741d22ef533ed",
};

/** A withdrawal's start: the one sent on testnet through the branch. */
const START = {
  amountWei: 5n * 10n ** 17n,
  sender: "0x5b18C80c82246E3ca49d340AdA0cDB8BCF7e5425",
};

/** What the wallet was handed, and whose account it was asked for. */
const signer = vi.hoisted(() => ({
  /** @type {any[]} */
  calls: [],
  submitter: "",
}));

vi.mock("$lib/stores", async (importOriginal) => {
  const stores = /** @type {any} */ (await importOriginal());
  /** @param {string} gql */
  const query = async (gql) => {
    const response = await globalThis.fetch(
      `${import.meta.env.VITE_NODE_URL}/on/graphql/query`,
      {
        body: `query { ${gql} }`,
        headers: { "Content-Type": "text/plain" },
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error(`GraphQL answered ${response.status}`);
    }

    return response.json();
  };
  /** @param {any} entry */
  const record = async (entry) => {
    signer.calls.push(entry);

    return { hash: "captured, never signed" };
  };

  return {
    ...stores,
    networkStore: {
      ...stores.networkStore,
      connect: async () => ({ query }),
      getLatestBlock: async () => {
        const { height, timestamp } = (
          await query("block(height: -1) { header { height timestamp } }")
        ).block.header;

        return { height: BigInt(height), timestamp: BigInt(timestamp) };
      },
    },
    walletStore: {
      ...stores.walletStore,
      // The base's two calls, which take the driver's input…
      finalizeDuskEvmWithdrawal: (
        /** @type {string} */ contractId,
        /** @type {string} */ wasmPath,
        /** @type {unknown} */ args,
        /** @type {any} */ gas
      ) =>
        record({
          args,
          contractId,
          fnName: "finalizeWithdrawalTransaction",
          gas,
          wasmPath,
        }),
      getDuskEvmProofSubmitter: () => signer.submitter,
      proveDuskEvmWithdrawal: (
        /** @type {string} */ contractId,
        /** @type {string} */ wasmPath,
        /** @type {unknown} */ args,
        /** @type {any} */ gas
      ) =>
        record({
          args,
          contractId,
          fnName: "proveWithdrawalTransaction",
          gas,
          wasmPath,
        }),
      // …and the branch's, which takes the call as the package built it.
      sendDuskEvmWithdrawalCall: (
        /** @type {any} */ call,
        /** @type {any} */ gas
      ) => record({ call, gas }),
    },
  };
});

const nodeFetch = /** @type {typeof fetch} */ (
  /** @type {any} */ (globalThis).nodeFetch
);

// Testnet's node and DuskEVM, and the drivers served with the wallet.
globalThis.fetch = /** @type {typeof fetch} */ (
  async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);

    return url.startsWith("/drivers/")
      ? new Response(readFileSync(resolve(`static${url}`)))
      : nodeFetch(input, init);
  }
);

/** @param {ArrayLike<number>} bytes */
const hex = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString("hex");

/** @type {Map<string, Promise<any>>} */
const drivers = new Map();

/**
 * What the base's wallet signs for its arguments: w3sper's encoding with the
 * driver it's given, as its contract call does.
 *
 * @param {string} wasmPath
 * @param {string} contractId
 * @param {string} fnName
 * @param {unknown} args
 */
async function encodedArgs(wasmPath, contractId, fnName, args) {
  if (!drivers.has(wasmPath)) {
    drivers.set(
      wasmPath,
      dataDrivers
        .load(new Uint8Array(readFileSync(resolve(`static${wasmPath}`))))
        .then((driver) => {
          driver.init();

          return driver;
        })
    );
  }

  return new Contract({
    contractId,
    driver: await drivers.get(wasmPath),
  }).encode(fnName, args);
}

/**
 * What the wallet was handed last, as it signs it.
 *
 * @returns {Promise<Record<string, string>>}
 */
async function lastSigned() {
  const entry = signer.calls.at(-1);

  if (entry.call) {
    const { call, gas } = entry;

    return {
      callGasLimit: String(call.gasLimit),
      contractId: call.contractId,
      deposit: String(call.deposit),
      fnArgs: hex(call.fnArgs),
      fnName: call.fnName,
      gasLimit: String(gas.limit),
      gasPrice: String(gas.price),
    };
  }

  const { args, contractId, fnName, gas, wasmPath } = entry;

  return {
    callGasLimit: String(gas.limit),
    contractId,
    // The base's contract call leaves the deposit unset: the transfer's 0.
    deposit: "0",
    fnArgs: hex(await encodedArgs(wasmPath, contractId, fnName, args)),
    fnName,
    gasLimit: String(gas.limit),
    gasPrice: String(gas.price),
  };
}

/**
 * @template T
 * @param {() => Promise<T>} read
 */
const settled = (read) =>
  read().then(
    (value) => ({ value }),
    (/** @type {unknown} */ error) => ({
      error: error instanceof Error ? error.message : String(error),
    })
  );

/** The fields the tracking keeps of a withdrawal's status. */
const KEPT = [
  "actionError",
  "amountWei",
  "blockNumber",
  "claimOverdue",
  "proofGame",
  "proofRejected",
  "proofSubmitter",
  "readyAt",
  "readyAtExact",
  "recipient",
  "sentAt",
  "stage",
  "statusMessage",
  "trackingError",
  "withdrawalHash",
];

/** The compressed key an account names, as w3sper's account gives it. */
function accountKey() {
  const digits = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;

  for (const character of ACCOUNT) {
    value = value * 58n + BigInt(digits.indexOf(character));
  }

  return Uint8Array.from(
    value.toString(16).padStart(192, "0").match(/../g) ?? [],
    (byte) => parseInt(byte, 16)
  );
}

/** The start's call, as this checkout builds it. */
async function start() {
  const { withdrawalStart } = /** @type {any} */ (withdrawals);
  const base = import.meta.glob("/src/lib/bridge/withdrawalInitiation.js");
  const load = base["/src/lib/bridge/withdrawalInitiation.js"];
  const call = withdrawalStart
    ? withdrawalStart({ ...START, to: ACCOUNT })
    : /** @type {any} */ (await load()).prepareNativeDuskWithdrawalCall({
        accountPublicKey: { valueOf: accountKey },
        amountWei: START.amountWei,
        evmRecipient: START.sender,
        minGasLimit: 200_000,
      });

  return {
    data: String(call.data).toLowerCase(),
    to: String(call.to).toLowerCase(),
    value: String(call.value),
  };
}

/**
 * A withdrawal's status as the tracking keeps it, and its proof or its claim
 * where one can be made now, with the claim date a proof shows.
 *
 * @param {string} hash
 * @param {string | null} sender
 */
async function captureWithdrawal(hash, sender) {
  const tx = /** @type {`0x${string}`} */ (hash);

  rememberWithdrawalTransaction(tx, { account: sender });
  await refreshWithdrawalTransaction(hash);

  const kept = /** @type {Record<string, unknown>} */ (
    getRememberedWithdrawalTransaction(hash)
  );
  const signed = signer.calls.length;
  const proveNow =
    kept.stage === "ready_to_prove"
      ? await settled(() => withdrawals.loadProveNowClaim(tx))
      : undefined;

  if (kept.stage === "ready_to_prove") {
    await settled(() => withdrawals.proveWithdrawal(tx));
  } else if (kept.stage === "ready_to_finalize") {
    await settled(() => withdrawals.finalizeWithdrawal(tx));
  }

  return {
    proveNow,
    signed: signer.calls.length > signed ? await lastSigned() : undefined,
    status: Object.fromEntries(KEPT.map((key) => [key, kept[key]])),
  };
}

/**
 * A claim its prover can make now, signed as them.
 *
 * @param {string} hash
 * @param {string} prover
 */
async function captureProverClaim(hash, prover) {
  const tx = /** @type {`0x${string}`} */ (hash);

  signer.submitter = prover;

  const signed = signer.calls.length;
  const status = await settled(() => withdrawals.loadWithdrawalStatus(tx));
  const claim =
    status.value?.stage === "ready_to_finalize"
      ? await settled(() => withdrawals.finalizeWithdrawal(tx))
      : null;

  return {
    claim: signer.calls.length > signed ? await lastSigned() : claim,
    prover,
    stage: status.value?.stage ?? status,
  };
}

it("captures what this checkout hands the wallet to sign", async () => {
  setNodeNetwork(networks.testnet);
  signer.submitter = evmAddressOf(ACCOUNT).toLowerCase();

  /** @type {Record<string, any>} */
  const out = {
    at: new Date().toISOString(),
    claims: {},
    config: withdrawals.getWithdrawalFinalizationConfig(),
    found: {},
    proofs: {},
    proveNow: {},
    proverClaims: {},
    start: await settled(start),
    statuses: {},
    timing: await settled(() => withdrawals.loadWithdrawalTiming()),
  };
  /** @type {Map<string, string | null>} */
  const sentBy = new Map(VECTORS.map((hash) => [hash, null]));

  for (const sender of SENDERS) {
    const listed = await settled(() => fetchWithdrawalActivity(sender));

    out.found[sender] = listed;
    (listed.value ?? []).forEach((item) =>
      sentBy.set(item.transactionHash, sender)
    );
  }

  for (const [hash, sender] of sentBy) {
    const { proveNow, signed, status } = await captureWithdrawal(hash, sender);

    out.statuses[hash] = status;
    out.proveNow[hash] = proveNow;
    out.proofs[hash] = signed;
  }

  const proved = Object.values(out.statuses)
    .filter(({ proofGame, withdrawalHash }) => proofGame && withdrawalHash)
    .map(({ withdrawalHash }) => withdrawalHash);
  const claims = await settled(() =>
    withdrawals.readWithdrawalClaims(proved, {
      submitter: /** @type {`0x${string}`} */ (signer.submitter),
    })
  );

  out.claims = claims.value ? Object.fromEntries(claims.value) : claims;

  for (const [hash, prover] of Object.entries(PROVERS)) {
    out.proverClaims[hash] = await captureProverClaim(hash, prover);
  }

  writeFileSync(
    String(process.env.CAPTURE_OUT ?? "withdrawal-calls.json"),
    JSON.stringify(
      out,
      (_key, value) => (typeof value === "bigint" ? `${value}n` : value),
      2
    )
  );

  expect(Object.keys(out.statuses).length).toBeGreaterThan(0);
});
