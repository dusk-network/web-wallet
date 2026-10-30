/**
 * Bridge › Activity's rows, as the Dusk Bridge lists its transfers: each
 * deposit and withdrawal by its route, its amount, a line with when it was
 * sent, when it can be claimed or what it waits for, its state, and what
 * needs doing, in groups: what needs you, what's under way, withdrawals that
 * pay someone else and this account hasn't proved, what's done and what
 * didn't go through.
 */

import { claimText } from "@dusk-network/networks/duskevm";

import { claimDay } from "$lib/bridge/claimDate";
import {
  isDepositDelayed,
  isDepositStalled,
} from "$lib/bridge/depositLifecycle";
import { routeTimeText } from "$lib/bridge/routeTimes";
import { formatDusk } from "$lib/dusk/currency";
import { shortenAddress } from "$lib/dusk/string";

import { claimDateOf } from "./withdrawalPresentation";

/**
 * @typedef {"done" | "failed" | "needs" | "other" | "progress"} BridgeActivityGroup
 *
 * @typedef {{
 *   action: "claim" | "prove" | null,
 *   amount: string,
 *   forOther: boolean,
 *   from: string,
 *   group: BridgeActivityGroup,
 *   hash: string,
 *   id: string,
 *   item: any,
 *   kind: "deposit" | "migration" | "service" | "withdrawal",
 *   line: string,
 *   state: "" | "Failed" | "Pending",
 *   title: string,
 *   to: string,
 *   when: number,
 * }} BridgeActivityRow
 *   `action` is what the row asks for: proving or claiming a withdrawal on
 *   Dusk; `forOther` that it pays someone else and this account hasn't
 *   proved it, so it's offered quietly.
 *   `state` is said for what's under way and what failed; a done row says
 *   nothing.
 *
 * @typedef {{
 *   account?: string,
 *   locale: string,
 *   steps?: Map<string, { claim?: string, prove?: string }>,
 *   time?: RouteTime | null,
 * }} BridgeActivityOptions
 *   `time` is how long the route takes on this network, where it's known;
 *   `account` the Dusk account the activity is of; `steps` each withdrawal's
 *   proof and claim in that account's history, by the withdrawal's hash.
 */

/** The groups, in order, with their heads. */
export const BRIDGE_ACTIVITY_GROUPS =
  /** @type {readonly (readonly [BridgeActivityGroup, string])[]} */ (
    Object.freeze([
      ["needs", "Needs you"],
      ["progress", "In progress"],
      ["other", "Sent to someone else"],
      ["done", "Completed"],
      ["failed", "Didn't go through"],
    ])
  );

const WEI_PER_LUX = 1_000_000_000n;

/**
 * An amount in Lux or wei, as the wallet writes DUSK: "" when it isn't
 * known.
 *
 * @param {{ amountLux?: string | null, amountWei?: string | null }} item
 * @param {string} locale
 */
function amountOf({ amountLux, amountWei }, locale) {
  const lux = /^\d+$/.test(amountLux ?? "")
    ? BigInt(/** @type {string} */ (amountLux))
    : /^\d+$/.test(amountWei ?? "")
      ? BigInt(/** @type {string} */ (amountWei)) / WEI_PER_LUX
      : null;

  return lux === null ? "" : `${formatDusk(lux, locale)} DUSK`;
}

/**
 * A time as one of the items keeps it, in milliseconds: null if it hasn't.
 *
 * @param {unknown} value An ISO date or milliseconds
 */
function msOf(value) {
  const ms = typeof value === "number" ? value : Date.parse(String(value));

  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** A withdrawal's line at the steps where it says the same each time. */
const WITHDRAWAL_LINES = new Map([
  ["failed", "The DUSK is still on DuskEVM"],
  ["finalize_submitted", "Claim sent, waiting for Dusk"],
  ["finalized", "Claimed on Dusk"],
  ["prove_submitted", "Proof sent, waiting for Dusk"],
  ["ready_to_finalize", "Ready to claim on Dusk"],
  ["ready_to_prove", "Ready to prove on Dusk"],
]);

/**
 * A withdrawal's line: what it waits for, when it can be claimed, or what
 * happened.
 *
 * @param {any} item
 * @param {BridgeActivityOptions} options
 */
function withdrawalLine(item, { locale, time }) {
  const day = (/** @type {number} */ ms) => claimDay(ms, locale);
  const sent = msOf(item.sentAt ?? item.timestamp);
  const fixed = WITHDRAWAL_LINES.get(item.stage);

  if (fixed) {
    return fixed;
  }

  if (item.stage === "proven_waiting") {
    return item.proofRejected
      ? "Proof rejected · prove it again once DuskEVM reports a new output"
      : claimText(claimDateOf(item), day) || "Proved, not claimable yet";
  }

  if (item.stage === "waiting_for_output") {
    return sent && time?.prove
      ? `Prove from about ${day(sent + time.prove * 1_000)}`
      : "Not on Dusk yet · usually within an hour";
  }

  return sent ? `Sent ${day(sent)}` : "Sent";
}

/** @type {ReadonlyMap<string, BridgeActivityGroup>} */
const WITHDRAWAL_GROUPS = new Map([
  ["failed", "failed"],
  ["finalized", "done"],
  ["ready_to_finalize", "needs"],
  ["ready_to_prove", "needs"],
]);

/**
 * Whether a withdrawal pays a Dusk account other than the one the activity
 * is of, as its DuskEVM transaction says.
 *
 * @param {any} item
 * @param {string | undefined} account
 */
const paysOther = (item, account) =>
  Boolean(item.recipient && account && item.recipient !== account);

/**
 * The stages a withdrawal's reads give once the account the activity is of
 * proved it: they're read for that account.
 */
const PROVED_STAGES = new Set([
  "finalize_submitted",
  "prove_submitted",
  "proven_waiting",
  "ready_to_finalize",
]);

/**
 * Whether the account the activity is of proved a withdrawal, so that only
 * it can claim it: its history has the proof, or the withdrawal's own reads
 * say so, by the game this account's proof went against (kept while a
 * rejected proof is proved again) or by its stage. A stage the explorer
 * gave, before any read, could be anyone's.
 *
 * @param {any} item
 * @param {BridgeActivityOptions["steps"]} steps
 */
function isProvedHere(item, steps) {
  const hash = String(item.withdrawalHash ?? "").toLowerCase();

  return (
    hash !== "" &&
    (Boolean(item.proofGame) ||
      Boolean(steps?.get(hash)?.prove) ||
      PROVED_STAGES.has(item.stage))
  );
}

/**
 * Whom a withdrawal pays, as its row says it: an account, or a contract.
 *
 * @param {string} recipient
 */
const payeeOf = (recipient) =>
  /^[0-9a-f]{64}$/.test(recipient)
    ? `contract ${shortenAddress(recipient)}`
    : shortenAddress(recipient);

/**
 * What a withdrawal's row says of where it is: Failed, Pending while it's
 * under way, or nothing.
 *
 * @param {BridgeActivityGroup} stageGroup The group its stage puts it in
 */
const withdrawalState = (stageGroup) =>
  stageGroup === "failed"
    ? "Failed"
    : stageGroup === "progress"
      ? "Pending"
      : "";

/**
 * A withdrawal from DuskEVM to Dusk as a row. One that pays someone else
 * says whom, and waits in a group of its own until it's done, unless this
 * account proved it: its claim is then this account's to make.
 *
 * @param {any} item As the withdrawal activity keeps it
 * @param {BridgeActivityOptions} options
 * @returns {BridgeActivityRow}
 */
export function withdrawalRow(item, options) {
  const paysElse = paysOther(item, options.account);
  const forOther = paysElse && !isProvedHere(item, options.steps);
  const stageGroup = WITHDRAWAL_GROUPS.get(item.stage) ?? "progress";
  const group =
    forOther && stageGroup !== "done" && stageGroup !== "failed"
      ? "other"
      : stageGroup;
  const line = withdrawalLine(item, options);

  return {
    action:
      item.stage === "ready_to_prove"
        ? "prove"
        : item.stage === "ready_to_finalize"
          ? "claim"
          : null,
    amount: amountOf(item, options.locale),
    forOther,
    from: "duskEvm",
    group,
    hash: item.transactionHash,
    id: `withdrawal:${item.transactionHash}`,
    item,
    kind: "withdrawal",
    line: paysElse
      ? `Pays ${payeeOf(item.recipient)} · ${line.charAt(0).toLowerCase()}${line.slice(1)}`
      : line,
    state: withdrawalState(stageGroup),
    title: "DuskEVM to Dusk",
    to: "duskDs",
    when: msOf(item.sentAt ?? item.timestamp) ?? item.createdAt ?? 0,
  };
}

/**
 * A deposit's line: when it was sent and how long it takes, or when it
 * arrived, with the DuskEVM address it pays; or why it failed.
 *
 * @param {any} item
 * @param {BridgeActivityOptions} options
 */
function depositLine(item, { locale, time }) {
  if (item.stage === "failed") {
    return item.failureLayer === "l1"
      ? "The DUSK didn't leave Dusk"
      : "Delivery failed on DuskEVM · don't send it again";
  }

  const sent = `Sent ${claimDay(item.createdAt, locale)}`;
  const usual = routeTimeText(time ?? null);
  const when =
    item.stage === "completed"
      ? item.arrivedAt
        ? `Arrived ${claimDay(item.arrivedAt, locale)}`
        : "Arrived on DuskEVM"
      : isDepositStalled(item) || isDepositDelayed(item)
        ? `${sent} · taking longer than usual`
        : usual
          ? `${sent} · takes ${usual}`
          : sent;

  return item.account ? `${when} · to ${shortenAddress(item.account)}` : when;
}

/**
 * A deposit from Dusk to DuskEVM as a row.
 *
 * @param {any} item As the deposit activity keeps it
 * @param {BridgeActivityOptions} options
 * @returns {BridgeActivityRow}
 */
export function depositRow(item, options) {
  const group =
    item.stage === "completed"
      ? "done"
      : item.stage === "failed"
        ? "failed"
        : "progress";

  return {
    action: null,
    amount: amountOf(item, options.locale),
    forOther: false,
    from: "duskDs",
    group,
    hash: item.transactionHash,
    id: `deposit:${item.transactionHash}`,
    item,
    kind: "deposit",
    line: depositLine(item, options),
    state:
      group === "failed" ? "Failed" : group === "progress" ? "Pending" : "",
    title: "Dusk to DuskEVM",
    to: "duskEvm",
    when: item.createdAt ?? 0,
  };
}

/**
 * What a transfer between Dusk and another chain's row says, by its stage.
 *
 * @param {import("$lib/bridge/migrationActivity").RouteTransfer} transfer
 * @param {BridgeActivityOptions} options
 */
function routeTransferLine(transfer, { locale, time }) {
  const day = (/** @type {number} */ ms) => claimDay(ms, locale);
  const sent = transfer.at ? `Sent ${day(transfer.at)}` : "Sent";
  const usual = routeTimeText(time ?? null);

  switch (transfer.stage) {
    case "paid":
      return transfer.paidAt ? `Paid ${day(transfer.paidAt)}` : "Paid on Dusk";
    case "arrived":
      return transfer.arrivedAt
        ? `Arrived ${day(transfer.arrivedAt)}`
        : `Arrived on ${transfer.route.chain.name}`;
    case "failed":
      return (
        transfer.failure ??
        `The migration failed on ${transfer.route.chain.name}`
      );
    default:
      return usual ? `${sent} · takes ${usual}` : sent;
  }
}

/**
 * A transfer between Dusk and another chain as a row: a migration into
 * Dusk, paid once the route's payout account pays it, or a transfer out,
 * sent until it arrives.
 *
 * @param {import("$lib/bridge/migrationActivity").RouteTransfer} transfer
 * @param {BridgeActivityOptions} options
 * @returns {BridgeActivityRow}
 */
export function routeTransferRow(transfer, options) {
  const { route } = transfer;
  const group =
    transfer.stage === "failed"
      ? "failed"
      : transfer.stage === "paid" || transfer.stage === "arrived"
        ? "done"
        : "progress";
  const name = (/** @type {string} */ id) =>
    id === "duskDs" ? "Dusk" : route.chain.name;

  return {
    action: null,
    amount:
      transfer.amountLux > 0n
        ? `${formatDusk(transfer.amountLux, options.locale)} DUSK`
        : "",
    forOther: false,
    from: route.origin,
    group,
    hash: transfer.hash,
    id: `${transfer.kind}:${transfer.hash}`,
    item: transfer,
    kind: transfer.kind,
    line: routeTransferLine(transfer, options),
    state:
      group === "failed" ? "Failed" : group === "progress" ? "Pending" : "",
    title: `${name(route.origin)} to ${name(route.destination)}`,
    to: route.destination,
    when: transfer.at ?? transfer.paidAt ?? 0,
  };
}

/**
 * The rows by group, each newest first, without the empty groups.
 *
 * @param {BridgeActivityRow[]} rows
 * @returns {{ group: BridgeActivityGroup, head: string, rows: BridgeActivityRow[] }[]}
 */
export const groupBridgeActivity = (rows) =>
  BRIDGE_ACTIVITY_GROUPS.map(([group, head]) => ({
    group,
    head,
    rows: rows
      .filter((row) => row.group === group)
      .sort((a, b) => b.when - a.when),
  })).filter(({ rows: inGroup }) => inGroup.length);

/**
 * Each withdrawal's proof and claim on Dusk, by the withdrawal's hash, as
 * the history has them: the newest of each that didn't fail.
 *
 * @param {ActivityRow[]} rows Newest first
 * @returns {Map<string, { claim?: string, prove?: string }>}
 */
export function withdrawalDuskTransactions(rows) {
  /** @type {Map<string, { claim?: string, prove?: string }>} */
  const steps = new Map();

  for (const { bridge, hash, status } of rows) {
    const step =
      bridge?.step === "proof"
        ? "prove"
        : bridge?.step === "claim"
          ? "claim"
          : null;

    if (step && bridge?.hash && status !== "failed") {
      const known = steps.get(bridge.hash) ?? {};

      if (!known[step]) {
        steps.set(bridge.hash, { ...known, [step]: hash });
      }
    }
  }

  return steps;
}
