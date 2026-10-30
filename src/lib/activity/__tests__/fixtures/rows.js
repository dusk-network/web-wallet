/**
 * History's rows for a test, as `@dusk-network/app-core/activity` makes
 * them from the fields a test is about: the archive's entry of a
 * transaction (`source: "archive"`, the default), the shielded history's
 * (`"shielded"`), the wallet's own record of a send (`"local"`), or both the
 * archive's entry and the wallet's record (`"both"`).
 */

import { activityRows } from "@dusk-network/app-core/activity";
import { historyEntry } from "@dusk-network/app-core/history";

/** @typedef {import("@dusk-network/app-core/activity").ActivityInput} ActivityInput */
/** @typedef {import("@dusk-network/networks").Network} Network */

/**
 * A network with DuskEVM's bridge and Portal at `id`, as the wallet sets
 * them for a local deployment.
 *
 * @param {Network} net
 * @param {string} id
 * @returns {Network}
 */
export const withBridge = (net, id) =>
  /** @type {Network} */ (
    /** @type {unknown} */ ({
      ...net,
      duskEvm: {
        ...net.duskEvm,
        contracts: {
          ...net.duskEvm?.contracts,
          ["l1_standard_bridge"]: { contractId: id },
          ["optimism_portal"]: { contractId: id },
        },
      },
    })
  );

/**
 * The outcome a row's fields say: theirs, or the one their status names.
 *
 * @param {Record<string, any>} fields
 * @returns {boolean | null}
 */
const successOf = ({ status, success }) =>
  success !== undefined
    ? success
    : status === "executed"
      ? true
      : status === "failed"
        ? false
        : null;

/**
 * The archive's entry of a transaction, as the history reads it.
 *
 * @param {Record<string, any>} f
 * @param {ActivityInput["network"]} network
 */
const entryOf = (f, network) =>
  historyEntry(
    {
      ...f,
      blockHeight: f.blockHeight,
      counterparty: f.to ?? f.from ?? f.counterparty ?? null,
      direction: f.direction ?? "out",
      fee: f.feePaid,
      hash: f.hash,
      kind: f.kind ?? "transfer",
      memo: f.memo ?? "",
      payer: f.payer ?? f.direction !== "in",
      success: successOf(f) ?? undefined,
      value: f.amount ?? f.deposit ?? "0",
    },
    { network }
  );

/**
 * The shielded history's entry of a transaction.
 *
 * @param {Record<string, any>} f
 * @returns {import("@dusk-network/app-core/shielded").ShieldedEntry}
 */
const shieldedOf = (f) => ({
  blockHeight: f.blockHeight,
  direction: f.direction ?? "in",
  error: f.error,
  fee: f.feePaid ?? null,
  hash: f.hash,
  kind: f.kind ?? "transfer",
  success: f.status !== "failed",
  timestamp: f.timestamp ?? null,
  value: f.amount ?? "0",
});

/**
 * The rows of a history, newest first, from each transaction's fields.
 *
 * @param {Record<string, any>[]} list
 * @param {Partial<ActivityInput>} [input]
 * @returns {ActivityRow[]}
 */
export function rowsOf(list, input = {}) {
  /** @type {import("@dusk-network/app-core/history").ReadEntry[]} */
  const entries = [];
  /** @type {import("@dusk-network/app-core/shielded").ShieldedEntry[]} */
  const shielded = [];
  /** @type {import("@dusk-network/app-core/activity").SentTransaction[]} */
  const pending = [];
  const names = new Map(input.names);

  for (const { counterpartyName, source = "archive", ...f } of list) {
    if (counterpartyName) {
      names.set(f.to ?? f.from ?? f.counterparty, counterpartyName);
    }

    if (source === "shielded") {
      shielded.push(shieldedOf(f));
    } else {
      if (source !== "local") {
        entries.push(entryOf(f, input.network));
      }

      if (source === "local" || source === "both") {
        pending.push(
          /** @type {import("@dusk-network/app-core/activity").SentTransaction} */ ({
            status: "submitted",
            submittedAt: Date.now(),
            ...f,
          })
        );
      }
    }
  }

  return activityRows({ ...input, names, pending, public: entries, shielded });
}

/**
 * One transaction's row.
 *
 * @param {Record<string, any>} fields
 * @param {Partial<ActivityInput>} [input]
 * @returns {ActivityRow}
 */
export const rowOf = (fields, input) => rowsOf([fields], input)[0];
