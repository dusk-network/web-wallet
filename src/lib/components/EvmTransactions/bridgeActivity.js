/**
 * Bridge › Activity's rows, as the Dusk Bridge lists its transfers: each
 * deposit and withdrawal by its route, its amount, a line with when it was
 * sent, when it can be claimed or what it waits for, its state, and what
 * needs doing, in groups: what needs you, what's under way, withdrawals that
 * pay someone else and this account hasn't proved, what's done and what
 * didn't go through.
 */

import { transferLedger } from "@dusk-network/app-core/bridge";
import { claimText } from "@dusk-network/networks/duskevm";

import { claimDay } from "$lib/bridge/claimDate";
import {
  isDepositDelayed,
  isDepositStalled,
} from "$lib/bridge/depositLifecycle";
import { routeTimeText } from "$lib/bridge/routeTimes";
import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
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
function amountOf(item, locale) {
  const lux = luxOfItem(item);

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
 * Whether a transfer has taken more than twice its usual time.
 *
 * @param {import("$lib/bridge/migrationActivity").RouteTransfer} transfer
 * @param {RouteTime | null | undefined} time
 * @param {number} [now]
 */
const isLate = (transfer, time, now = Date.now()) =>
  Boolean(time && transfer.at && now - transfer.at > 2 * time.seconds * 1000);

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
      return transfer.paidAt
        ? `Arrived ${day(transfer.paidAt)}`
        : "Arrived on Dusk";
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
      if (isLate(transfer, time)) {
        return `${sent} · taking longer than usual`;
      }

      return usual ? `${sent} · takes ${usual}` : sent;
  }
}

/**
 * What a row shows for a transfer: what arrived once it has, as the fee came
 * out of what was sent, and what was sent until then.
 *
 * @param {import("$lib/bridge/migrationActivity").RouteTransfer} transfer
 */
const shownLux = ({ amountLux, feeLux, stage }) =>
  stage === "arrived" && feeLux && amountLux > feeLux
    ? amountLux - feeLux
    : amountLux;

/**
 * An amount as a deposit or a withdrawal keeps it, in lux: null if it hasn't.
 *
 * @param {{ amountLux?: string | null, amountWei?: string | null }} item
 * @returns {bigint | null}
 */
const luxOfItem = ({ amountLux, amountWei }) =>
  /^\d+$/.test(amountLux ?? "")
    ? BigInt(/** @type {string} */ (amountLux))
    : /^\d+$/.test(amountWei ?? "")
      ? BigInt(/** @type {string} */ (amountWei)) / WEI_PER_LUX
      : null;

/**
 * A row's transfer in amounts, the same in all the Dusk apps, for its details:
 * what was sent, the bridge's fee, the network's, what arrived and the gas paid
 * on the other chain, as far as each is known.
 *
 * @param {BridgeActivityRow} activity
 * @param {{ locale: string, rows: ActivityRow[], steps: Map<string, { claim?: string, prove?: string }> }} context
 *   `rows` the history; `steps` a withdrawal's proof and claim on Dusk
 * @returns {import("@dusk-network/app-core/bridge").TransferLedger | null}
 */
export function ledgerOf({ item, kind }, { locale, rows, steps }) {
  /** @param {string | null | undefined} hash */
  const inHistory = (hash) =>
    (hash && rows.find((row) => row.hash === hash)) || null;

  switch (kind) {
    case "deposit":
      return transferLedger({
        failed: item.stage === "failed",
        locale,
        received: item.stage === "completed" ? luxOfItem(item) : null,
        route: /** @type {any} */ ({ kind: "duskevm-deposit" }),
        row: inHistory(item.transactionHash),
        sent: luxOfItem(item),
      });
    case "withdrawal": {
      const { claim, prove } = steps.get(item.withdrawalHash ?? "") ?? {};

      return transferLedger({
        failed: item.stage === "failed",
        locale,
        networkFee: [inHistory(prove)?.fee, inHistory(claim)?.fee],
        received: item.stage === "finalized" ? luxOfItem(item) : null,
        route: /** @type {any} */ ({ kind: "duskevm-withdrawal" }),
        sent: luxOfItem(item),
      });
    }
    case "migration":
      return transferLedger({
        failed: item.stage === "failed",
        gasWei: item.gasWei,
        locale,
        // The bridge paid for the payout.
        networkFee: null,
        received: item.stage === "paid" ? item.amountLux : null,
        route: item.route,
        row: inHistory(item.payout),
        sent: item.amountLux,
      });
    default:
      return transferLedger({
        bridgeFee: item.feeLux,
        locale,
        received:
          item.arrivedLux ??
          (item.stage === "arrived" && item.amountLux > (item.feeLux ?? 0n)
            ? item.amountLux - (item.feeLux ?? 0n)
            : null),
        route: item.route,
        row: inHistory(item.hash),
        sent: item.amountLux,
      });
  }
}

/**
 * How a transfer just sent is getting on, in words, where there's more to say
 * than that it's on its way: `null` otherwise.
 *
 * @param {import("$lib/bridge/migrationActivity").RouteTransfer} transfer
 * @param {{ locale?: string, masked?: boolean, now?: number, time?: RouteTime | null }} options
 * @returns {{ heading?: string, sentence: string } | null}
 */
export function transferOutcome(
  transfer,
  { locale, masked = false, now = Date.now(), time }
) {
  const { failure, route, stage } = transfer;
  const what = masked
    ? "It"
    : `${formatDuskExact(shownLux(transfer), locale)} DUSK`;

  switch (stage) {
    case "arrived":
      return {
        heading: "Arrived",
        sentence: `${what} arrived on ${route.chain.name}.`,
      };
    case "paid":
      return {
        heading: "Arrived",
        sentence: `${what} arrived in your public balance on Dusk.`,
      };
    case "failed":
      return {
        heading: "It didn't go through",
        sentence: `${failure ?? `The migration failed on ${route.chain.name}`}.`,
      };
    default:
      return isLate(transfer, time, now)
        ? { sentence: "It's taking longer than usual." }
        : null;
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
        ? `${formatDusk(shownLux(transfer), options.locale)} DUSK`
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
 * the history has them: the newest of each that didn't fail. Each is what
 * its call says it is: a claim that pays the account shown is still a claim.
 *
 * @param {ActivityRow[]} rows Newest first
 * @returns {Map<string, { claim?: string, prove?: string }>}
 */
export function withdrawalDuskTransactions(rows) {
  /** @type {Map<string, { claim?: string, prove?: string }>} */
  const steps = new Map();

  for (const { entry, hash, sent, status } of rows) {
    const call = entry?.bridge ?? sent?.bridge;

    if (
      (call?.kind === "prove" || call?.kind === "claim") &&
      call.hash &&
      status !== "failed"
    ) {
      const withdrawal = call.hash.toLowerCase();
      const known = steps.get(withdrawal) ?? {};

      if (!known[call.kind]) {
        steps.set(withdrawal, { ...known, [call.kind]: hash });
      }
    }
  }

  return steps;
}
