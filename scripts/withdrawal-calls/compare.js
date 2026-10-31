#!/usr/bin/env node
/**
 * Compares what two checkouts of the wallet hand their wallet to sign for
 * user2's real testnet withdrawals: this one and another (the base), each
 * read from testnet at the same time, with the wallet stubbed so that it
 * records and never signs or sends (capture.spec.js). For each withdrawal:
 * its status as the tracking keeps it, and its proof's or its claim's
 * contract, function, arguments (byte for byte), deposit, gas limit and gas
 * price; then the claim dates History reads, the waits, and a withdrawal's
 * start, which with `--tx` is checked against the one sent on DuskEVM.
 *
 * Not run in CI. Both checkouts need their dependencies installed. The
 * capture is copied into the other checkout for the run, then removed.
 *
 *   node scripts/withdrawal-calls/compare.js <other checkout> [--tx <DuskEVM tx>]
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const HERE = resolve(import.meta.dirname, "../..");
const OTHER = resolve(process.argv[2] ?? "");
const TX = process.argv.includes("--tx")
  ? process.argv[process.argv.indexOf("--tx") + 1]
  : undefined;
const DIR = "scripts/withdrawal-calls";
const FILES = ["capture.spec.js", "keep-fetch.js", "vitest.config.js"];

if (!process.argv[2] || !existsSync(join(OTHER, "package.json"))) {
  console.error("usage: compare.js <other checkout> [--tx <DuskEVM tx>]");
  process.exit(2);
}

/** The capture's files put in the other checkout for the run. */
const copied = FILES.filter((file) => !existsSync(join(OTHER, DIR, file)));

mkdirSync(join(OTHER, DIR), { recursive: true });
copied.forEach((file) =>
  copyFileSync(join(HERE, DIR, file), join(OTHER, DIR, file))
);

/**
 * @param {string} root
 * @param {string} name
 * @returns {Promise<any>}
 */
const capture = (root, name) =>
  new Promise((done, fail) => {
    const out = join(tmpdir(), `withdrawal-calls-${name}.json`);
    const run = spawn(
      "npx",
      ["vitest", "run", "--config", `${DIR}/vitest.config.js`],
      { cwd: root, env: { ...process.env, CAPTURE_OUT: out }, stdio: "inherit" }
    );

    run.on("exit", (code) =>
      code === 0
        ? done(JSON.parse(readFileSync(out, "utf8")))
        : fail(new Error(`The capture in ${root} ended with ${code}`))
    );
  });

let here;
let other;

try {
  // At the same time: both read the same games.
  [here, other] = await Promise.all([
    capture(HERE, "here"),
    capture(OTHER, "other"),
  ]);
} finally {
  copied.forEach((file) => unlinkSync(join(OTHER, DIR, file)));

  try {
    rmdirSync(join(OTHER, DIR));
    rmdirSync(join(OTHER, "scripts"));
  } catch {
    // Left where it held more.
  }
}

const json = (/** @type {unknown} */ value) => JSON.stringify(value ?? null);
/** @type {string[]} */
const differences = [];
/** @type {string[]} */
const lines = [];

/**
 * @param {string} what
 * @param {unknown} a
 * @param {unknown} b
 */
function same(what, a, b) {
  const equal = json(a) === json(b);

  if (!equal) {
    differences.push(`${what}: ${json(b)} (other) vs ${json(a)} (here)`);
  }

  return equal;
}

const SIGNED = [
  "contractId",
  "fnName",
  "fnArgs",
  "deposit",
  "gasLimit",
  "gasPrice",
  "callGasLimit",
];

same("config", pick(here.config), pick(other.config));
same("timing", here.timing, other.timing);
same("start", here.start, other.start);

for (const sender of Object.keys({ ...here.found, ...other.found })) {
  same(`found by ${sender}`, here.found[sender], other.found[sender]);
}

for (const hash of Object.keys({ ...here.statuses, ...other.statuses })) {
  const a = here.statuses[hash];
  const b = other.statuses[hash];
  const status = Object.keys({ ...a, ...b }).every((key) =>
    same(`${hash} status ${key}`, a?.[key], b?.[key])
  );
  const proofA = here.proofs[hash];
  const proofB = other.proofs[hash];
  const signed =
    proofA || proofB
      ? SIGNED.every((key) =>
          same(`${hash} ${key}`, proofA?.[key], proofB?.[key])
        )
      : null;
  const dated = same(
    `${hash} claim if proved now`,
    here.proveNow[hash],
    other.proveNow[hash]
  );

  lines.push(
    [
      hash,
      a?.stage ?? b?.stage,
      status ? "same" : "DIFFERENT",
      signed === null
        ? "-"
        : `${proofA?.fnName ?? proofB?.fnName} ${proofA?.fnArgs?.length / 2 || "?"} bytes ${signed ? "same" : "DIFFERENT"}`,
      dated ? "same" : "DIFFERENT",
    ].join(" | ")
  );
}

same("claims", here.claims, other.claims);

for (const hash of Object.keys({
  ...here.proverClaims,
  ...other.proverClaims,
})) {
  const a = here.proverClaims[hash];
  const b = other.proverClaims[hash];
  const signed = SIGNED.every((key) =>
    same(
      `${hash} claim by ${a?.prover} ${key}`,
      a?.claim?.[key],
      b?.claim?.[key]
    )
  );

  same(`${hash} stage for ${a?.prover}`, a?.stage, b?.stage);
  lines.push(
    [
      hash,
      `claim by its prover ${a?.prover}`,
      a?.stage,
      a?.claim?.fnName
        ? `${a.claim.fnName} ${a.claim.fnArgs.length / 2} bytes ${signed ? "same" : "DIFFERENT"}`
        : json(a?.claim),
    ].join(" | ")
  );
}

if (TX) {
  const sent = await fetch(here.config.l2RpcUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [TX],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => response.json());
  const { input, to, value } = sent.result ?? {};

  same(`start vs ${TX} on DuskEVM`, here.start?.value, {
    data: String(input).toLowerCase(),
    to: String(to).toLowerCase(),
    value: String(BigInt(value ?? 0)),
  });
}

console.log(
  `\n${basename(HERE)} (here, read ${here.at}) vs ${OTHER} (other, read ${other.at})\n`
);
console.log("withdrawal | stage | status | signed | claim date if proved now");
lines.forEach((line) => console.log(line));
console.log(`\nstart: ${json(here.start)}`);
console.log(`timing: ${json(here.timing)}`);
console.log(
  differences.length
    ? `\n${differences.length} differences:\n${differences.join("\n")}`
    : "\nNo differences."
);
process.exitCode = differences.length ? 1 : 0;

/** @param {any} config */
function pick(config) {
  const {
    configured,
    disputeGameFactoryContractId,
    disputeGameFactoryDataDriverUrl,
    l2RpcUrl,
    optimismPortalContractId,
    optimismPortalDataDriverUrl,
  } = config ?? {};

  return {
    configured,
    disputeGameFactoryContractId,
    disputeGameFactoryDataDriverUrl,
    l2RpcUrl,
    optimismPortalContractId,
    optimismPortalDataDriverUrl,
  };
}
