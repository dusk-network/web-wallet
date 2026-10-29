/**
 * How the history's rows read: their titles, lines, amounts and statuses,
 * the day groups and times they show under, the filters they answer to, and
 * the CSV an export holds. Pure functions of the rows.
 */

import {
  formatDusk,
  formatDuskExact,
  formatDuskPlain,
  formatFee,
} from "$lib/dusk/currency/formatDusk";

import { labelFor, routes } from "@dusk-network/networks";
import { formatTime } from "@dusk-network/networks/format";

import { shortenAddress } from "$lib/dusk/string";

import { SOZU_FN, isSozuCall } from "$lib/sozu/config";
import { claimDay, claimText } from "$lib/bridge/claimDate";

import { knownCall } from "./knownContracts";

import { TX_KIND } from "./constants";
import { configuredBridge } from "$lib/bridge/bridgeCalls";

/**
 * @typedef {"all" | "bridge" | "received" | "sent" | "staking"} ActivityKindFilter
 * @typedef {"all" | "public" | "shielded"} ActivityPrivacyFilter
 * @typedef {"bridge" | "call" | "received" | "self" | "sent" | "shield" | "staking"} ActivityIcon
 * @typedef {"failed" | "pending" | "unknown" | null} ActivityShownStatus
 *
 * @typedef {{
 *   bridgeContracts?: Set<string>,
 *   claimed?: Set<string>,
 *   claims?: Map<string, import("$lib/bridge/withdrawals").WithdrawalClaim>,
 *   contactNames?: Map<string, string>,
 *   locale: string,
 *   network?: string,
 *   now?: number,
 *   ownAccount?: string,
 *   reservations?: Map<string, string>,
 *   routeAccounts?: RouteAccounts,
 *   sozuPools?: Set<string>,
 * }} PresentContext
 *
 * `claimed` holds the withdrawals the rows claim (claimedWithdrawals),
 * `claims` when the proved ones can be claimed, by their hashes, as the
 * chain says (withdrawalClaims in $lib/bridge), `reservations` the `.dusk`
 * name each reservation was for, by its hash (reservedNames),
 * `routeAccounts` the network's (routeAccountsOf), and `sozuPools` the
 * pools Sozu's hub named (sozuPools in $lib/sozu).
 *
 * @typedef {{
 *   labels: Map<string, string>,
 *   payouts: Set<string>,
 *   services: Set<string>,
 * }} RouteAccounts
 *   The accounts of the network's routes to and from other chains: those
 *   that pay migrations out on Dusk (`payouts`), those a transfer out goes
 *   to (`services`), and what the network's file calls them (`labels`).
 *
 * @typedef {{
 *   claim: import("$lib/bridge/claimDate").ClaimDate | null,
 *   claimed: boolean,
 *   ready: boolean,
 *   reprove: boolean,
 * }} WithdrawalStep
 *   Where a proved withdrawal is: claimed, ready to claim, or when it can
 *   be claimed, as the chain says; no date until that has been read, nor
 *   when its proof must be made again (`reprove`).
 *
 * @typedef {{
 *   amount: { exact: string, muted: boolean, sign: "" | "+" | "−", text: string },
 *   category: Exclude<ActivityKindFilter, "all"> | "other",
 *   counterparty: string | null,
 *   icon: ActivityIcon,
 *   line: string,
 *   note: string | null,
 *   privacy: "Public" | "Shielded",
 *   shortLine: string,
 *   status: ActivityShownStatus,
 *   title: string,
 *   titleIsAddress: boolean,
 *   withdrawal: WithdrawalStep | null,
 * }} ActivityPresentation
 *   `note` is a proved withdrawal's claim date, as `line` ends, for a line
 *   of its own where a row is narrow; `shortLine` is `line` without it.
 */

/**
 * A contract ID as the history keeps them: lower case, no 0x.
 *
 * @param {unknown} id
 */
export const normalizeContractId = (id) =>
  String(id ?? "")
    .toLowerCase()
    .replace(/^0x/, "");

/**
 * The bridge's contracts on Dusk: the deposit bridge and the withdrawal
 * portal.
 *
 * @returns {Set<string>}
 */
export function configuredBridgeContracts() {
  const { bridge, portal } = configuredBridge();

  return new Set([bridge, portal].filter(Boolean));
}

/**
 * The accounts of a network's routes to and from other chains, by what its
 * file calls them, or after the chain where it doesn't; none without a
 * network.
 *
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 * @returns {RouteAccounts}
 */
export function routeAccountsOf(net) {
  /** @type {RouteAccounts} */
  const accounts = {
    labels: new Map(),
    payouts: new Set(),
    services: new Set(),
  };

  for (const route of net ? routes(net) : []) {
    const account =
      route.kind === "migration"
        ? route.payoutAccount
        : route.kind === "service"
          ? route.account
          : null;

    if (account && net) {
      (route.kind === "migration" ? accounts.payouts : accounts.services).add(
        account
      );
      accounts.labels.set(
        account,
        labelFor(net, account) ?? `${route.chain.name} bridge`
      );
    }
  }

  return accounts;
}

/** @param {string | undefined} value */
const toLux = (value) => {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
};

/**
 * An address or a hash shortened, as everywhere in the wallet
 * (`shortenAddress`).
 *
 * @param {string} address
 */
export const shortAddress = (address) => shortenAddress(address);

/**
 * Whether a row is the bridge's: a call to one of its contracts.
 *
 * @param {ActivityRow} row
 * @param {Set<string> | undefined} bridgeContracts
 */
const isBridge = (row, bridgeContracts) =>
  Boolean(
    bridgeContracts?.size &&
    [row.contractId, row.counterparty].some((id) =>
      bridgeContracts.has(normalizeContractId(id))
    )
  );

/**
 * The counterparty a row names: the account it went to or came from.
 *
 * @param {ActivityRow} row
 * @returns {string | null}
 */
const counterpartyOf = (row) => row.to ?? row.from ?? row.counterparty ?? null;

/**
 * Whether a row moved DUSK on a route to or from another chain: a payout
 * of a migration in, or a transfer out to the route's account.
 *
 * @param {ActivityRow} row
 * @param {RouteAccounts} [routeAccounts]
 */
const isRouteTransfer = (row, routeAccounts) => {
  const counterparty = counterpartyOf(row);
  const accounts =
    row.direction === "in"
      ? routeAccounts?.payouts
      : row.direction === "out"
        ? routeAccounts?.services
        : undefined;

  return Boolean(counterparty && accounts?.has(counterparty));
};

/**
 * What a row is, for its icon and the filters. A transfer on a route to or
 * from another chain is the bridge's, and reads as the transfer it is.
 *
 * @param {ActivityRow} row
 * @param {Set<string> | undefined} bridgeContracts
 * @param {Set<string>} [sozuPools]
 * @param {RouteAccounts} [routeAccounts]
 * @returns {{ category: ActivityPresentation["category"], icon: ActivityIcon }}
 */
function classify(row, bridgeContracts, sozuPools, routeAccounts) {
  switch (row.kind) {
    case TX_KIND.STAKE:
    case TX_KIND.UNSTAKE:
    case TX_KIND.WITHDRAW_REWARD:
      return { category: "staking", icon: "staking" };
    case TX_KIND.SHIELD:
    case TX_KIND.UNSHIELD:
      return { category: "other", icon: "shield" };
    default:
      break;
  }

  if (isSozuCall(row, sozuPools)) {
    return { category: "staking", icon: "staking" };
  }

  if (isBridge(row, bridgeContracts)) {
    return { category: "bridge", icon: "bridge" };
  }

  if (isRouteTransfer(row, routeAccounts)) {
    return {
      category: "bridge",
      icon: row.direction === "in" ? "received" : "sent",
    };
  }

  if (row.direction === "self") {
    return { category: "other", icon: "self" };
  }

  if (row.direction === "in") {
    return { category: "received", icon: "received" };
  }

  return {
    category: "sent",
    icon: row.kind === TX_KIND.CONTRACT_CALL ? "call" : "sent",
  };
}

/** @type {Map<ActivityKind, [string, string]>} */
const KIND_TITLES = new Map([
  [TX_KIND.SHIELD, ["Shielded", "Public to shielded"]],
  [TX_KIND.STAKE, ["Staked", "Staking"]],
  [TX_KIND.UNSHIELD, ["Unshielded", "Shielded to public"]],
  [TX_KIND.UNSTAKE, ["Unstaked", "Staking"]],
  [TX_KIND.WITHDRAW_REWARD, ["Rewards claimed", "Staking"]],
]);

/**
 * What a bridge transaction did: DUSK to or from DuskEVM, or a step of a
 * withdrawal that moved nothing but its fee.
 *
 * @param {ActivityRow} row
 */
function bridgeTitle(row) {
  if (row.direction === "in") {
    return "From DuskEVM";
  }

  if (toLux(row.amount) > 0n) {
    return "To DuskEVM";
  }

  if (row.bridge?.kind === "deposit") {
    return "To DuskEVM";
  }

  const fn = String(row.fnName ?? "").toLowerCase();

  return fn.includes("prove")
    ? "Withdrawal proved"
    : fn.includes("finalize")
      ? "Withdrawal claimed"
      : "Bridge call";
}

/**
 * A row's title and the first part of its line. A counterparty saved as a
 * contact goes by the contact's name, with its `.dusk` name after it, a
 * route's account by what the network's file calls it, and a call to a
 * contract the wallet knows by what it did.
 *
 * @param {ActivityRow} row
 * @param {ActivityIcon} icon
 * @param {PresentContext} context
 * @returns {{ title: string, titleIsAddress: boolean, verb: string }}
 */
function titleOf(
  row,
  icon,
  { contactNames, network, reservations, routeAccounts }
) {
  const kindTitle = row.kind ? KIND_TITLES.get(row.kind) : undefined;

  if (kindTitle) {
    return { title: kindTitle[0], titleIsAddress: false, verb: kindTitle[1] };
  }

  if (icon === "staking") {
    return {
      title:
        row.fnName === SOZU_FN.STAKE
          ? "Staked with Sozu"
          : "Unstaked from Sozu",
      titleIsAddress: false,
      verb: "Liquid staking",
    };
  }

  if (icon === "bridge") {
    return { title: bridgeTitle(row), titleIsAddress: false, verb: "Bridge" };
  }

  if (icon === "self") {
    return { title: "To yourself", titleIsAddress: false, verb: "Sent" };
  }

  const named =
    icon === "call"
      ? knownCall(
          { ...row, reservedName: reservations?.get(row.hash) },
          network
        )
      : null;

  if (named) {
    return { title: named.label, titleIsAddress: false, verb: named.app };
  }

  return counterpartyTitle(row, icon, contactNames, routeAccounts?.labels);
}

/**
 * What a row's other side is called: the contact's name, with its `.dusk`
 * name after it, the verified `.dusk` name, or the account's label; "" for
 * none.
 *
 * @param {ActivityRow} row
 * @param {Map<string, string>} [contactNames] Contact names by address
 * @param {Map<string, string>} [labels] Labels by account
 */
function nameOf(row, contactNames, labels) {
  const counterparty = counterpartyOf(row);
  const name = row.counterpartyName ?? row.toName;
  const contact = counterparty ? contactNames?.get(counterparty) : undefined;

  if (contact && name) {
    return `${contact} · ${name}`;
  }

  return (
    contact ?? name ?? (counterparty ? labels?.get(counterparty) : null) ?? ""
  );
}

/**
 * The title of a row with someone on the other side: what it's called, the
 * call, or the short address.
 *
 * @param {ActivityRow} row
 * @param {ActivityIcon} icon
 * @param {Map<string, string>} [contactNames] Contact names by address
 * @param {Map<string, string>} [labels] Labels by account
 * @returns {{ title: string, titleIsAddress: boolean, verb: string }}
 */
function counterpartyTitle(row, icon, contactNames, labels) {
  const counterparty = counterpartyOf(row);
  const verb = row.direction === "in" ? "Received" : "Sent";
  const named = nameOf(row, contactNames, labels);

  if (named) {
    return { title: named, titleIsAddress: false, verb };
  }

  if (icon === "call") {
    return {
      title: row.fnName ? `Called ${row.fnName}` : "Contract call",
      titleIsAddress: false,
      verb: "Contract",
    };
  }

  return counterparty
    ? { title: shortAddress(counterparty), titleIsAddress: true, verb }
    : { title: verb, titleIsAddress: false, verb };
}

/**
 * Whether a row is staking: natively, or with Sozu.
 *
 * @param {ActivityRow} row
 * @param {Set<string>} [sozuPools] The pools Sozu's hub named
 */
export const isStakingRow = (row, sozuPools) =>
  classify(row, undefined, sozuPools).category === "staking";

/**
 * The status a row shows: only while it isn't final, or when it failed.
 *
 * @param {ActivityRow} row
 * @returns {ActivityShownStatus}
 */
function shownStatus(row) {
  switch (row.status) {
    case "failed":
      return "failed";
    case "mempool":
    case "submitted":
      return "pending";
    case "removed":
    case "unknown":
      // An archive entry is final: only its outcome isn't looked up yet.
      return row.source === "archive" ? null : "unknown";
    default:
      return null;
  }
}

/**
 * How a row reads: its icon, title, line, privacy, amount and status.
 *
 * A failed transaction sent nothing: its amount shows without a sign and
 * muted, and its line says what it cost.
 *
 * @param {ActivityRow} row
 * @param {PresentContext} context
 * @returns {ActivityPresentation}
 */
export function describeRow(row, context) {
  const { bridgeContracts, locale, routeAccounts, sozuPools } = context;
  const { category, icon } = classify(
    row,
    bridgeContracts,
    sozuPools,
    routeAccounts
  );
  const { title, titleIsAddress, verb } = titleOf(row, icon, context);
  const status = shownStatus(row);
  const failed = status === "failed";
  const bridge = icon === "bridge" && !failed ? bridgeOf(row, context) : null;
  const line = failed
    ? `Failed · nothing sent · ${feeText(row, locale)}`
    : bridge?.line
      ? `${verb} · ${bridge.line}`
      : verb;
  const note = claimNoteOf(bridge);

  return {
    amount: amountOf(row, { bridge, failed, icon, locale }),
    category,
    counterparty: bridge?.to ?? counterpartyOf(row),
    icon,
    line,
    note,
    privacy: row.privacy === "shielded" ? "Shielded" : "Public",
    shortLine: note ? verb : line,
    status,
    title,
    titleIsAddress,
    withdrawal: bridge?.withdrawal ?? null,
  };
}

/**
 * A proved withdrawal's claim date, as its line ends, for a line of its
 * own: "Claim from about 2 Nov, 04:20". None for any other row.
 *
 * @param {ReturnType<typeof bridgeOf>} bridge
 * @returns {string | null}
 */
const claimNoteOf = (bridge) =>
  bridge?.line && bridge.withdrawal && !bridge.withdrawal.claimed
    ? `${bridge.line.charAt(0).toUpperCase()}${bridge.line.slice(1)}`
    : null;

/**
 * The fee a row's sender paid, for its line.
 *
 * @param {ActivityRow} row
 * @param {string} locale
 */
const feeText = (row, locale) =>
  row.feePaid
    ? `fee ${formatFee(toLux(row.feePaid), locale)} DUSK paid`
    : "no fee";

/**
 * A row's amount: what it moved, signed by its direction, or what a bridge
 * call was for, unsigned. A failed transaction and a withdrawal not claimed
 * yet show theirs muted.
 *
 * @param {ActivityRow} row
 * @param {{ bridge: ReturnType<typeof bridgeOf>, failed: boolean, icon: ActivityIcon, locale: string }} options
 * @returns {ActivityPresentation["amount"]}
 */
function amountOf(row, { bridge, failed, icon, locale }) {
  const lux = bridge?.amount ?? toLux(row.amount);
  const unsigned =
    failed ||
    icon === "shield" ||
    icon === "self" ||
    bridge?.amount !== undefined ||
    lux === 0n;

  return {
    exact: formatDuskExact(lux, locale),
    muted: failed || bridge?.withdrawal?.claimed === false,
    sign: unsigned ? "" : row.direction === "in" ? "+" : "−",
    text: formatDusk(lux, locale),
  };
}

/**
 * A proved withdrawal's line: claimed, ready to claim, its proof to make
 * again, or when it can be claimed, as the chain says ("claim from about
 * Mon 2 Nov, 04:20"); none until that has been read.
 *
 * @param {WithdrawalStep} withdrawal
 * @param {string} locale
 */
function withdrawalLine(withdrawal, locale) {
  if (withdrawal.claimed) {
    return "claimed";
  }

  if (withdrawal.ready) {
    return "ready to claim";
  }

  if (withdrawal.reprove) {
    return "proof rejected · prove it again";
  }

  const text = claimText(withdrawal.claim, (ms) => claimDay(ms, locale));

  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * What a bridge call adds to its row: the DuskEVM address a deposit went
 * to, or the amount a withdrawal's proof or claim is for (only where the
 * transaction itself moved none of it), and where a proved withdrawal is.
 *
 * @param {ActivityRow} row
 * @param {PresentContext} context
 * @returns {{ amount?: bigint, line?: string, to?: string, withdrawal?: WithdrawalStep } | null}
 */
function bridgeOf(row, { claimed, claims, locale }) {
  const call = row.bridge;

  if (!call) {
    return null;
  }

  if (call.kind === "deposit") {
    return { line: `to ${shortAddress(call.to)}`, to: call.to };
  }

  const amount = toLux(row.amount) === 0n ? toLux(call.amount) : undefined;

  if (call.kind !== "prove") {
    return { amount };
  }

  // When it can be claimed, as the chain says, once that has been read.
  const read = call.hash ? claims?.get(call.hash.toLowerCase()) : undefined;
  /** @type {WithdrawalStep} */
  const withdrawal = {
    claim: read?.at
      ? { at: read.at, exact: read.exact, overdue: read.overdue }
      : null,
    claimed: Boolean(claimed?.has(call.withdrawal) || read?.claimed),
    ready: Boolean(read?.ready),
    reprove: Boolean(read?.reprove),
  };

  return { amount, line: withdrawalLine(withdrawal, locale), withdrawal };
}

/**
 * The withdrawals the rows claim, for the proofs before them.
 *
 * @param {ActivityRow[]} rows
 * @returns {Set<string>}
 */
export function claimedWithdrawals(rows) {
  return new Set(
    rows.flatMap((row) =>
      row.bridge?.kind === "claim" && row.status !== "failed"
        ? [row.bridge.withdrawal]
        : []
    )
  );
}

/**
 * When a row happened, in milliseconds: its block's time, or when the
 * wallet sent it; null when neither is known yet.
 *
 * @param {ActivityRow} row
 * @returns {number | null}
 */
export const rowTime = (row) => row.timestamp ?? row.submittedAt ?? null;

/**
 * Whether a row answers the filters.
 *
 * @param {ActivityPresentation} presentation
 * @param {ActivityRow} row
 * @param {{ kind?: ActivityKindFilter, privacy?: ActivityPrivacyFilter, since?: number | null }} filters
 */
export function matchesFilters(
  presentation,
  row,
  { kind = "all", privacy = "all", since = null }
) {
  const time = rowTime(row);

  return (
    (kind === "all" || presentation.category === kind) &&
    (privacy === "all" || presentation.privacy.toLowerCase() === privacy) &&
    // A row with no time yet isn't in a range of days.
    (since === null || (time !== null && time >= since))
  );
}

/**
 * The local calendar day of a time, as a key.
 *
 * @param {number} time
 */
const dayKey = (time) => {
  const d = new Date(time);

  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * How the locale tells the time and writes its digits.
 *
 * @param {string} locale
 */
function clockOf(locale) {
  const resolved = new Intl.DateTimeFormat(locale || undefined, {
    hour: "numeric",
  }).resolvedOptions();

  return {
    english: /^en(-|$)/i.test(resolved.locale),
    hourCycle: resolved.hourCycle ?? (resolved.hour12 ? "h12" : "h23"),
    numberingSystem: resolved.numberingSystem,
  };
}

/**
 * The heading of a day, in English with the locale's digits: "Today",
 * "Yesterday", or its date, as "Sat 24 Oct". With `full`, today and
 * yesterday show their date too.
 *
 * @param {number} time
 * @param {{ full?: boolean, locale: string, now?: number }} options
 */
export function dayLabel(time, { full = false, locale, now = Date.now() }) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    numberingSystem: clockOf(locale).numberingSystem,
    weekday: "short",
  })
    .format(time)
    .replace(",", "");
  const today = dayKey(now);

  // The calendar's day before, not 24 hours before: a day the clocks change
  // is 23 or 25 hours long.
  const before = new Date(now);

  before.setDate(before.getDate() - 1);

  const yesterday = dayKey(before.getTime());
  const key = dayKey(time);
  const relative =
    key === today ? "Today" : key === yesterday ? "Yesterday" : "";

  if (!relative) {
    return date;
  }

  return full ? `${relative} · ${date}` : relative;
}

/**
 * Rows in groups by local day, newest first, as they come; rows without a
 * time yet go in a last group.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number | null} timeOf
 * @param {{ full?: boolean, locale: string, now?: number }} options
 * @returns {{ items: T[], key: string, label: string }[]}
 */
export function groupByDay(items, timeOf, options) {
  /** @type {Map<string, { items: T[], key: string, label: string }>} */
  const groups = new Map();

  for (const item of items) {
    const time = timeOf(item);
    const key = time === null ? "unknown" : dayKey(time);
    let group = groups.get(key);

    if (!group) {
      group = {
        items: [],
        key,
        label: time === null ? "Time not known yet" : dayLabel(time, options),
      };
      groups.set(key, group);
    }

    group.items.push(item);
  }

  const unknown = groups.get("unknown");

  groups.delete("unknown");

  return unknown ? [...groups.values(), unknown] : [...groups.values()];
}

/**
 * The time of day, on the locale's clock, with English words: "14:32", or
 * "2:32 PM".
 *
 * @param {number} time
 * @param {string} locale
 */
export function timeLabel(time, locale) {
  const { english, hourCycle, numberingSystem } = clockOf(locale);
  const h24 = hourCycle === "h23" || hourCycle === "h24";

  return new Intl.DateTimeFormat(english ? locale : "en-US", {
    hour: h24 ? "2-digit" : "numeric",
    hourCycle,
    minute: "2-digit",
    numberingSystem,
  }).format(time);
}

/**
 * A full date and time with its time zone, in English on the locale's
 * clock: "Mon 26 Oct 2026, 14:32 CET".
 *
 * @param {number} time
 * @param {string} locale
 */
export const fullDateTime = (time, locale) =>
  formatTime(time, { date: "full", locale: locale || undefined });

/**
 * A field of a CSV line, quoted when it holds a separator, a quote or a
 * line break.
 *
 * @param {unknown} value
 */
function csvField(value) {
  const text = String(value ?? "");

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * A field of text someone else chose, as a memo or a name: never read as a
 * formula by a spreadsheet.
 *
 * @param {unknown} value
 */
const csvText = (value) => {
  const text = String(value ?? "");

  return csvField(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
};

/** The columns of an export. */
export const CSV_COLUMNS = Object.freeze([
  "Date (UTC)",
  "Date (local)",
  "Block",
  "Transaction ID",
  "Direction",
  "Type",
  "What",
  "Counterparty name",
  "Counterparty",
  "Amount (DUSK)",
  "Fee paid (DUSK)",
  "Memo",
  "Status",
]);

/** The column an export adds with the user's own contact names. */
export const CSV_CONTACT_COLUMN = "Your contact name";

/** @type {Record<string, string>} */
const STATUS_WORDS = {
  executed: "Completed",
  failed: "Failed",
  mempool: "Pending",
  removed: "Unknown",
  submitted: "Pending",
  unknown: "Unknown",
};

/**
 * Whether a row's time, fee and outcome are still to be looked up: a row
 * with no time, or one from the chain whose outcome isn't looked up yet.
 *
 * @param {ActivityRow} row
 */
export const isRowIncomplete = (row) =>
  rowTime(row) === null ||
  ((row.source === "archive" || row.source === "both") &&
    typeof row.success !== "boolean");

/**
 * One row as a CSV line. Its words never use the user's contact names:
 * those go in their own column, when asked for.
 *
 * @param {ActivityRow} row
 * @param {PresentContext} context
 * @param {boolean} withContacts
 */
function csvLine(row, context, withContacts) {
  const p = describeRow(row, { ...context, contactNames: undefined });
  const time = rowTime(row);
  const amount = p.status === "failed" ? 0n : toLux(row.amount);
  const signed = row.direction === "out" && amount ? -amount : amount;
  const dates =
    time === null
      ? ["", ""]
      : [new Date(time).toISOString(), fullDateTime(time, context.locale)];

  return [
    ...dates.map(csvField),
    csvField(row.blockHeight ?? ""),
    csvField(row.hash),
    csvField(row.direction ?? ""),
    csvField(p.privacy),
    csvText(p.titleIsAddress ? p.line : `${p.title} (${p.line})`),
    csvText(row.counterpartyName ?? row.toName ?? ""),
    csvField(p.counterparty ?? ""),
    csvField(formatDuskPlain(signed)),
    csvField(row.feePaid ? formatDuskPlain(toLux(row.feePaid)) : ""),
    csvText(row.memo ?? ""),
    csvField(csvStatus(row)),
    ...(withContacts ? [csvText(contactOf(p, context))] : []),
  ].join(",");
}

/**
 * A row's status in an export, or that it isn't looked up yet.
 *
 * @param {ActivityRow} row
 */
const csvStatus = (row) =>
  isRowIncomplete(row) ? "Not looked up yet" : (STATUS_WORDS[row.status] ?? "");

/**
 * The user's own name for a row's counterparty, if it is a contact.
 *
 * @param {ActivityPresentation} p
 * @param {PresentContext} context
 */
const contactOf = (p, context) =>
  (p.counterparty && context.contactNames?.get(p.counterparty)) || "";

/**
 * An export's file name: the network, the profile and the day where the
 * user is, as the wallet extension names its own:
 * "dusk-activity-testnet-profile-1-2026-10-29.csv".
 *
 * @param {{ network?: string, profileIndex?: number }} what
 * @param {Date} [now]
 */
export function csvFileName({ network, profileIndex = 0 }, now = new Date()) {
  const slug = String(network ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  const profile = `profile-${Math.max(0, Math.floor(Number(profileIndex) || 0)) + 1}`;

  return `${["dusk-activity", slug || "wallet", profile, day].join("-")}.csv`;
}

/**
 * The rows as CSV, one line each with the columns of CSV_COLUMNS, and the
 * user's contact names in CSV_CONTACT_COLUMN only `withContacts`. Amounts
 * are exact, with a minus for what left the account; a failed transaction
 * moved nothing, so its amount is 0 and its fee stands on its own. A row
 * not looked up yet says so in its status.
 *
 * @param {ActivityRow[]} rows
 * @param {PresentContext} context
 * @param {{ withContacts?: boolean }} [options]
 */
export function toCsv(rows, context, { withContacts = false } = {}) {
  const lines = rows.map((row) => csvLine(row, context, withContacts));
  const columns = withContacts
    ? [...CSV_COLUMNS, CSV_CONTACT_COLUMN]
    : CSV_COLUMNS;

  return [columns.map(csvField).join(","), ...lines].join("\r\n");
}
