/**
 * The history's rows: this wallet's own transactions with the selected
 * account's history from the archive (activityHistory.js) and its shielded
 * history, one row per transaction, newest first.
 *
 * A transaction both know is the chain's once it is final: its outcome,
 * amount, time and fee come from the archive. The wallet's own record adds
 * what the chain doesn't say, such as the .dusk name typed for the recipient.
 * Until the archive has it, the wallet's record shows it, pending or not.
 */

import { TX_KIND } from "./constants";

/** What the wallet's record of a transaction adds to the chain's. */
const LOCAL_ONLY = /** @type {const} */ ([
  "asset",
  "origin",
  "ownerProfileIndex",
  "payment",
  "pendingNullifiers",
  "reservationStatus",
  "submittedAt",
  "toName",
]);

/** @param {unknown} hash */
const lower = (hash) => String(hash ?? "").toLowerCase();

/**
 * @param {boolean | null} success
 * @returns {ActivityStatus}
 */
const statusOf = (success) =>
  success === true ? "executed" : success === false ? "failed" : "unknown";

/**
 * A synced history entry as a row, in the shape of the wallet's own records
 * (`amount`, `to`, `status`, …).
 *
 * @param {ActivityEntry} entry From activityHistory.readActivity
 * @returns {ActivityRow}
 */
export function historyRow(entry) {
  const amount = entry.value.toString();
  const call = entry.kind === TX_KIND.CONTRACT_CALL;
  const counterparty = entry.counterparty ?? undefined;

  return {
    amount,
    blockHash: entry.blockHash,
    blockHeight: entry.blockHeight,
    contractId: entry.contractId ?? (call ? counterparty : undefined),
    counterparty: entry.counterparty ?? null,
    deposit: call && amount !== "0" ? amount : undefined,
    detailsAt: entry.detailsAt,
    direction: entry.direction,
    error: entry.success === false ? entry.error : undefined,
    feePaid: entry.fee === null ? undefined : entry.fee.toString(),
    fnName: entry.fnName,
    from: entry.direction === "in" ? counterparty : undefined,
    gasLimit: entry.gasLimit,
    gasPrice: entry.gasPrice,
    gasSpent: entry.gasSpent,
    hash: lower(entry.hash),
    kind: entry.kind,
    memo: entry.memo || undefined,
    privacy: "public",
    source: "archive",
    // Final on chain, but its outcome is unknown until its details come.
    status: statusOf(entry.success),
    success: entry.success,
    timestamp: entry.timestamp ?? undefined,
    to: entry.direction === "out" && !call ? counterparty : undefined,
  };
}

/**
 * A row both the wallet and the chain know: the chain's, with what the
 * wallet's record adds.
 *
 * @param {ActivityRow} known
 * @param {Record<string, any>} tx
 * @returns {ActivityRow}
 */
function mergeLocal(known, tx) {
  const extra = Object.fromEntries(
    LOCAL_ONLY.filter((k) => tx[k] !== undefined).map((k) => [k, tx[k]])
  );

  // Until the chain's outcome is known, the wallet's own status stands.
  const outcome =
    typeof known.success === "boolean"
      ? { error: known.error, status: known.status }
      : { error: tx.error, status: tx.status ?? known.status };

  return {
    ...known,
    ...extra,
    ...outcome,
    contractId: known.contractId ?? tx.contractId,
    fnName: known.fnName ?? tx.fnName,
    gasLimit: known.gasLimit ?? tx.gasLimit,
    gasPrice: known.gasPrice ?? tx.gasPrice,
    // What the wallet sent, when the chain names it less closely.
    kind: tx.kind || known.kind,
    privacy: tx.privacy ?? known.privacy,
    profileIndex: tx.profileIndex,
    source: "both",
    to: known.to ?? tx.to,
  };
}

/**
 * Adds the shielded rows: the shielded side of a shield or unshield is the
 * public row's, with the fee the shielded side paid.
 *
 * @param {Map<string, ActivityRow>} rows
 * @param {ActivityRow[]} shielded
 */
function addShielded(rows, shielded) {
  for (const row of shielded) {
    const hash = lower(row?.hash);
    const known = rows.get(hash);

    if (!hash) {
      continue;
    }

    if (!known) {
      rows.set(hash, { ...row, hash });
    } else if (known.feePaid === undefined && row.feePaid !== undefined) {
      rows.set(hash, { ...known, feePaid: row.feePaid });
    }
  }
}

/**
 * Adds the wallet's own records of the selected profile, and those without
 * a profile.
 *
 * @param {Map<string, ActivityRow>} rows
 * @param {Record<string, any>[]} local
 * @param {number | undefined} profileIndex
 */
function addLocal(rows, local, profileIndex) {
  for (const tx of local) {
    const idx = tx?.profileIndex;
    const hash = lower(tx?.hash);
    const known = rows.get(hash);
    const otherProfile =
      idx !== undefined &&
      idx !== null &&
      profileIndex !== undefined &&
      Number(idx) !== Number(profileIndex);

    if (otherProfile || !hash) {
      continue;
    }

    rows.set(
      hash,
      known
        ? mergeLocal(known, tx)
        : /** @type {ActivityRow} */ ({ ...tx, hash, source: "local" })
    );
  }
}

/**
 * The rows, newest first: this wallet's own transactions on this network,
 * the selected account's synced entries, and its shielded history's rows.
 * `names` are counterparties' verified names; `estimateTime` gives a time to
 * an entry not looked up yet, to sort it.
 *
 * @param {{
 *   estimateTime?: (blockHeight: number) => number | undefined,
 *   history?: ActivityEntry[],
 *   local?: Record<string, any>[],
 *   names?: Map<string, string | null>,
 *   profileIndex?: number,
 *   shielded?: ActivityRow[],
 * }} input
 * @returns {ActivityRow[]}
 */
export function mergeActivity({
  estimateTime,
  history = [],
  local = [],
  names,
  profileIndex,
  shielded = [],
} = {}) {
  /** @type {Map<string, ActivityRow>} */
  const rows = new Map();

  for (const entry of history) {
    const row = historyRow(entry);

    if (row.hash) {
      rows.set(row.hash, row);
    }
  }

  addShielded(rows, shielded);
  addLocal(rows, local, profileIndex);

  const out = [...rows.values()].map((row) => {
    const name = row.counterparty ? names?.get(row.counterparty) : undefined;

    return typeof name === "string" ? { ...row, counterpartyName: name } : row;
  });

  /** @param {ActivityRow & { finalizedAt?: number }} row */
  const time = (row) =>
    Number(row.timestamp ?? row.finalizedAt ?? row.submittedAt) ||
    (Number.isFinite(row.blockHeight)
      ? Number(estimateTime?.(/** @type {number} */ (row.blockHeight))) || 0
      : 0);

  return out.sort(
    (a, b) =>
      time(b) - time(a) ||
      (Number(b.blockHeight) || 0) - (Number(a.blockHeight) || 0) ||
      (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
  );
}
