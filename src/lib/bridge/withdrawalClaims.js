/**
 * When the withdrawals the history shows proved can be claimed, as the chain
 * says: read for the account's own proofs, at most once a minute each, and
 * kept for the account they were read for.
 */

import { writable } from "svelte/store";

import { walletStore } from "$lib/stores";

import { readWithdrawalClaims } from "./withdrawals";

/** How long a withdrawal's read stands before the history reads it again. */
const FRESH_MS = 60_000;

/** @typedef {import("./withdrawals").WithdrawalClaim} WithdrawalClaim */

const store = writable(/** @type {Map<string, WithdrawalClaim>} */ (new Map()));

/** The account the claims are read for: its proofs' submitter. */
let owner = "";

/** @type {Map<string, number>} When each withdrawal was read last. */
let readAt = new Map();

let isReading = false;

/** @type {ActivityRow[] | null} The rows of the last load that came while one was reading. */
let queued = null;

/**
 * The withdrawals the rows prove and no row claims: their hashes.
 *
 * @param {ActivityRow[]} rows
 * @returns {`0x${string}`[]}
 */
export function provedWithdrawals(rows) {
  const done = (/** @type {ActivityRow} */ row) => row.status === "failed";
  const claimed = new Set(
    rows.flatMap((row) =>
      row.bridge?.kind === "claim" && !done(row) ? [row.bridge.withdrawal] : []
    )
  );

  return [
    ...new Set(
      rows.flatMap((row) =>
        row.bridge?.kind === "prove" &&
        row.bridge.hash &&
        !done(row) &&
        !claimed.has(row.bridge.withdrawal)
          ? [/** @type {`0x${string}`} */ (row.bridge.hash.toLowerCase())]
          : []
      )
    ),
  ];
}

/**
 * The account the history's proofs are this wallet's: their submitter on
 * the Portal; none while no wallet is open. Another account's starts over.
 *
 * @returns {`0x${string}` | null}
 */
function submitterNow() {
  /** @type {`0x${string}`} */
  let submitter;

  try {
    submitter = walletStore.getDuskEvmProofSubmitter();
  } catch {
    return null;
  }

  if (submitter !== owner) {
    owner = submitter;
    readAt = new Map();
    store.set(new Map());
  }

  return submitter;
}

/**
 * Reads when the rows' proved withdrawals can be claimed, those not read in
 * the last minute; the store follows. A load that comes while one reads,
 * with other rows or for another account, runs once that read is done: the
 * last one only.
 *
 * @param {ActivityRow[]} rows
 * @returns {Promise<void>}
 */
async function load(rows) {
  if (isReading) {
    queued = rows;

    return;
  }

  isReading = true;

  try {
    await readDue(rows);
  } finally {
    isReading = false;
  }

  const next = queued;

  queued = null;

  if (next) {
    await load(next);
  }
}

/**
 * Reads the rows' proved withdrawals not read in the last minute, for the
 * account they're the proofs of.
 *
 * @param {ActivityRow[]} rows
 * @returns {Promise<void>}
 */
async function readDue(rows) {
  const submitter = submitterNow();
  const now = Date.now();
  const due = submitter
    ? provedWithdrawals(rows).filter(
        (hash) => now - (readAt.get(hash) ?? 0) >= FRESH_MS
      )
    : [];

  if (!submitter || !due.length) {
    return;
  }

  due.forEach((hash) => readAt.set(hash, now));

  try {
    const read = await readWithdrawalClaims(due, { submitter });

    if (owner === submitter) {
      store.update((kept) => new Map([...kept, ...read]));
    }
  } catch {
    // Read again the next time the history shows them.
    due.forEach((hash) => readAt.delete(hash));
  }
}

/** @type {import("svelte/store").Readable<Map<string, WithdrawalClaim>> & { load: typeof load }} */
export default { load, subscribe: store.subscribe };
