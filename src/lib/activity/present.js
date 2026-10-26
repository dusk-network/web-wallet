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

import { SOZU_FN, isSozuCall } from "$lib/sozu/config";

import { TX_KIND } from "./constants";

/**
 * @typedef {"all" | "bridge" | "received" | "sent" | "staking"} ActivityKindFilter
 * @typedef {"all" | "public" | "shielded"} ActivityPrivacyFilter
 * @typedef {"bridge" | "call" | "received" | "self" | "sent" | "shield" | "staking"} ActivityIcon
 * @typedef {"failed" | "pending" | "unknown" | null} ActivityShownStatus
 *
 * @typedef {{
 *   bridgeContracts?: Set<string>,
 *   contactNames?: Map<string, string>,
 *   locale: string,
 *   ownAccount?: string,
 * }} PresentContext
 *
 * @typedef {{
 *   amount: { exact: string, muted: boolean, sign: "" | "+" | "−", text: string },
 *   category: Exclude<ActivityKindFilter, "all"> | "other",
 *   counterparty: string | null,
 *   icon: ActivityIcon,
 *   line: string,
 *   privacy: "Public" | "Shielded",
 *   status: ActivityShownStatus,
 *   title: string,
 *   titleIsAddress: boolean,
 * }} ActivityPresentation
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
 * The bridge's contracts on Dusk, from the configuration: the deposit
 * bridge and the withdrawal portal.
 *
 * @returns {Set<string>}
 */
export function configuredBridgeContracts() {
  return new Set(
    [
      import.meta.env.VITE_BRIDGE_CONTRACT_ID,
      import.meta.env.VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID,
    ]
      .map(normalizeContractId)
      .filter(Boolean)
  );
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
 * An address shortened to its first and last six characters.
 *
 * @param {string} address
 */
export const shortAddress = (address) =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;

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
 * What a row is, for its icon and the filters.
 *
 * @param {ActivityRow} row
 * @param {Set<string> | undefined} bridgeContracts
 * @returns {{ category: ActivityPresentation["category"], icon: ActivityIcon }}
 */
function classify(row, bridgeContracts) {
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

  if (isSozuCall(row)) {
    return { category: "staking", icon: "staking" };
  }

  if (isBridge(row, bridgeContracts)) {
    return { category: "bridge", icon: "bridge" };
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
 * The counterparty a row names: the account it went to or came from.
 *
 * @param {ActivityRow} row
 * @returns {string | null}
 */
const counterpartyOf = (row) => row.to ?? row.from ?? row.counterparty ?? null;

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

  const fn = String(row.fnName ?? "").toLowerCase();

  return fn.includes("prove")
    ? "Withdrawal proved"
    : fn.includes("finalize")
      ? "Withdrawal claimed"
      : "Bridge call";
}

/**
 * A row's title and the first part of its line. A counterparty saved as a
 * contact goes by the contact's name, with its `.dusk` name after it.
 *
 * @param {ActivityRow} row
 * @param {ActivityIcon} icon
 * @param {Map<string, string>} [contactNames] Contact names by address
 * @returns {{ title: string, titleIsAddress: boolean, verb: string }}
 */
function titleOf(row, icon, contactNames) {
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

  return counterpartyTitle(row, icon, contactNames);
}

/**
 * The title of a row with someone on the other side: the contact's name,
 * the verified `.dusk` name, the call, or the short address.
 *
 * @param {ActivityRow} row
 * @param {ActivityIcon} icon
 * @param {Map<string, string>} [contactNames] Contact names by address
 * @returns {{ title: string, titleIsAddress: boolean, verb: string }}
 */
function counterpartyTitle(row, icon, contactNames) {
  const name = row.counterpartyName ?? row.toName;
  const counterparty = counterpartyOf(row);
  const verb = row.direction === "in" ? "Received" : "Sent";
  const contact = counterparty ? contactNames?.get(counterparty) : undefined;

  if (contact || name) {
    return {
      title: contact && name ? `${contact} · ${name}` : (contact ?? name ?? ""),
      titleIsAddress: false,
      verb,
    };
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
 */
export const isStakingRow = (row) =>
  classify(row, undefined).category === "staking";

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
export function describeRow(row, { bridgeContracts, contactNames, locale }) {
  const { category, icon } = classify(row, bridgeContracts);
  const { title, titleIsAddress, verb } = titleOf(row, icon, contactNames);
  const status = shownStatus(row);
  const lux = toLux(row.amount);
  const failed = status === "failed";
  const moved = icon === "shield" || icon === "self";
  const fee = row.feePaid
    ? `fee ${formatFee(toLux(row.feePaid), locale)} DUSK paid`
    : "no fee";

  return {
    amount: {
      exact: formatDuskExact(lux, locale),
      muted: failed,
      sign:
        failed || moved || lux === 0n ? "" : row.direction === "in" ? "+" : "−",
      text: formatDusk(lux, locale),
    },
    category,
    counterparty: counterpartyOf(row),
    icon,
    line: failed ? `Failed · nothing sent · ${fee}` : verb,
    privacy: row.privacy === "shielded" ? "Shielded" : "Public",
    status,
    title,
    titleIsAddress,
  };
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
    (since === null || time === null || time >= since)
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
 * The heading of a day: "Today", "Yesterday", or its date, as "Sat, 24 Oct".
 * With `full`, today and yesterday show their date too.
 *
 * @param {number} time
 * @param {{ full?: boolean, locale: string, now?: number }} options
 */
export function dayLabel(time, { full = false, locale, now = Date.now() }) {
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(time);
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
 * The time of day, as "14:32".
 *
 * @param {number} time
 * @param {string} locale
 */
export const timeLabel = (time, locale) =>
  new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);

/**
 * The short name of this browser's time zone at a time, as "CET".
 *
 * @param {number} time
 * @param {string} locale
 */
export function zoneLabel(time, locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZoneName: "short",
  }).formatToParts(time);

  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * A full date and time with its time zone, as "Mon, 26 Oct 2026, 14:32 CET".
 *
 * @param {number} time
 * @param {string} locale
 */
export const fullDateTime = (time, locale) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    weekday: "short",
    year: "numeric",
  }).format(time);

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
 * One row as a CSV line.
 *
 * @param {ActivityRow} row
 * @param {PresentContext} context
 */
function csvLine(row, context) {
  const p = describeRow(row, context);
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
    csvField(STATUS_WORDS[row.status] ?? ""),
  ].join(",");
}

/**
 * The rows as CSV, one line each with the columns of CSV_COLUMNS. Amounts
 * are exact, with a minus for what left the account; a failed transaction
 * moved nothing, so its amount is 0 and its fee stands on its own.
 *
 * @param {ActivityRow[]} rows
 * @param {PresentContext} context
 */
export function toCsv(rows, context) {
  const lines = rows.map((row) => csvLine(row, context));

  return [CSV_COLUMNS.map(csvField).join(","), ...lines].join("\r\n");
}
