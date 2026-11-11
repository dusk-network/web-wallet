/**
 * How the history's rows read: their titles, lines, amounts and statuses,
 * the day groups and times they show under, the filters they answer to, and
 * the CSV an export holds. Pure functions of the rows, which say what each
 * transaction did (`@dusk-network/app-core/activity`).
 */

import {
  formatDusk,
  formatDuskExact,
  formatFee,
} from "$lib/dusk/currency/formatDusk";

import { displayText } from "@dusk-network/app-core/text";
import { labelFor, routeForAccount } from "@dusk-network/networks";
import { claimText } from "@dusk-network/networks/duskevm";
import { formatTime } from "@dusk-network/networks/format";

import { shortenAddress } from "$lib/dusk/string";

import { claimDay } from "$lib/bridge/claimDate";

import { TX_KIND } from "./constants";

/**
 * @typedef {"all" | "bridge" | "received" | "sent" | "staking"} ActivityKindFilter
 * @typedef {"all" | "public" | "shielded"} ActivityPrivacyFilter
 * @typedef {"bridge" | "call" | "received" | "self" | "sent" | "shield" | "staking"} ActivityIcon
 * @typedef {"failed" | "pending" | "unknown" | null} ActivityShownStatus
 *
 * @typedef {{
 *   claims?: Map<string, import("$lib/bridge/withdrawals").WithdrawalClaim>,
 *   contactNames?: Map<string, string>,
 *   locale: string,
 *   net?: import("@dusk-network/networks").Network | null,
 *   walletNames?: Map<string, string>,
 * }} PresentContext
 *
 * `claims` says when the proved withdrawals can be claimed, by their
 * hashes, as the chain says (withdrawalClaims in $lib/bridge), `net` is
 * the network's file, for what it calls its routes' accounts, and
 * `walletNames` what the wallets here call their profiles' accounts and
 * addresses ($lib/wallets).
 *
 * @typedef {{
 *   claim: import("@dusk-network/networks/duskevm").ClaimDate | null,
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
 *   category: ActivityRow["category"],
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
 * What the network's file calls one of its routes' accounts to and from
 * other chains, or after the chain where it doesn't; null for any other
 * account, and without a network.
 *
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 * @param {string} account
 */
export function routeLabel(net, account) {
  const route = net
    ? (routeForAccount(net, account, "out") ??
      routeForAccount(net, account, "in"))
    : null;

  return net && route
    ? (labelFor(net, account) ?? `${route.chain.name} bridge`)
    : null;
}

/**
 * An address or a hash shortened, as everywhere in the wallet
 * (`shortenAddress`).
 *
 * @param {string} address
 */
export const shortAddress = (address) => shortenAddress(address);

/**
 * A row's icon, by what it did: a transfer on a route to or from another
 * chain is the bridge's.
 *
 * @param {ActivityRow} row
 * @returns {ActivityIcon}
 */
function iconOf(row) {
  switch (row.kind) {
    case TX_KIND.STAKE:
    case TX_KIND.UNSTAKE:
    case TX_KIND.WITHDRAW_REWARD:
      return "staking";
    case TX_KIND.SHIELD:
    case TX_KIND.UNSHIELD:
      return "shield";
    default:
      break;
  }

  if (row.sozu) {
    return "staking";
  }

  if (row.bridge || row.route) {
    return "bridge";
  }

  if (row.direction === "self") {
    return "self";
  }

  if (row.direction === "in") {
    return "received";
  }

  return row.kind === TX_KIND.CONTRACT_CALL ? "call" : "sent";
}

/** @type {Map<ActivityKind, [string, string]>} */
const KIND_TITLES = new Map([
  [TX_KIND.SHIELD, ["Shielded", "Public to shielded"]],
  [TX_KIND.STAKE, ["Staked", "Staking"]],
  [TX_KIND.UNSHIELD, ["Unshielded", "Shielded to public"]],
  [TX_KIND.UNSTAKE, ["Unstaked", "Staking"]],
  [TX_KIND.WITHDRAW_REWARD, ["Rewards claimed", "Staking"]],
]);

/** What a Dusk Domains call did, by what it is. */
/** @type {Readonly<Record<string, string>>} */
const NAME_CALLS = Object.freeze({
  issue: "Issued a reserved .dusk name",
  "primary-cleared": "Cleared the primary .dusk name",
  "primary-set": "Set a primary .dusk name",
  records: "Changed a .dusk name's records",
  registration: "Registered a .dusk name",
  renewal: "Renewed a .dusk name",
  reservation: "Name reservation (step 1 of 2)",
  subname: "Created a .dusk subname",
});

/** @type {Record<NonNullable<ActivityRow["bridge"]>["step"], string>} */
const BRIDGE_TITLES = {
  call: "Bridge call",
  claim: "Withdrawal claimed",
  deposit: "To DuskEVM",
  proof: "Withdrawal proved",
  withdrawal: "From DuskEVM",
};

/**
 * What a bridge transaction did: DUSK to or from DuskEVM or another chain
 * (as the extension says it), or a step of a withdrawal that moved nothing
 * but its fee.
 *
 * @param {ActivityRow} row
 */
function bridgeTitle(row) {
  if (row.route) {
    return `${row.direction === "in" ? "From" : "To"} ${row.route.chain.name}`;
  }

  return row.bridge ? BRIDGE_TITLES[row.bridge.step] : "Bridge call";
}

/**
 * A row's title and the first part of its line. A counterparty saved as a
 * contact goes by the contact's name, with its `.dusk` name after it, a
 * profile of a wallet here by what the wallets call it, a route's account
 * by what the network's file calls it, and a call to Dusk Domains by what
 * it did.
 *
 * @param {ActivityRow} row
 * @param {ActivityIcon} icon
 * @param {PresentContext} context
 * @returns {{ title: string, titleIsAddress: boolean, verb: string }}
 */
function titleOf(row, icon, context) {
  const kindTitle = row.kind ? KIND_TITLES.get(row.kind) : undefined;

  if (kindTitle) {
    return { title: kindTitle[0], titleIsAddress: false, verb: kindTitle[1] };
  }

  if (icon === "staking") {
    return {
      title: row.sozu === "stake" ? "Staked with Sozu" : "Unstaked from Sozu",
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

  const call = icon === "call" ? row.nameCall : null;

  if (call) {
    // What a transaction carries is anyone's text: it can't reorder itself.
    const name = call.name ? displayText(call.name).text : "";
    const label =
      call.kind === "registration" && name
        ? `Registered ${name}`
        : call.kind === "reservation" && name
          ? `Reserved ${name}`
          : (NAME_CALLS[call.kind] ?? "Dusk Domains");

    return { title: label, titleIsAddress: false, verb: "Dusk Domains" };
  }

  return counterpartyTitle(row, icon, context);
}

/**
 * The `.dusk` name a row names its other side by, as History says it after a
 * contact's name: the one verified for it, or else the one typed for it as
 * it was sent to; null for none.
 *
 * @param {ActivityRow} row
 * @returns {string | null}
 */
const duskNameOf = (row) => row.counterpartyName ?? row.toName ?? null;

/**
 * The `.dusk` names the history names its counterparties by, as History does,
 * by their addresses: the newest row's.
 *
 * @param {ActivityRow[]} rows The history, newest first
 * @returns {Map<string, string>}
 */
export function historyDuskNames(rows) {
  /** @type {Map<string, string>} */
  const names = new Map();

  for (const row of rows) {
    const name = duskNameOf(row);

    if (row.counterparty && name && !names.has(row.counterparty)) {
      names.set(row.counterparty, name);
    }
  }

  return names;
}

/**
 * What a row's other side is called: the contact's name, with its `.dusk`
 * name after it, the verified `.dusk` name, what the wallets here call a
 * profile of theirs, or its route's label; "" for none.
 *
 * @param {ActivityRow} row
 * @param {PresentContext} context
 */
function nameOf(row, { contactNames, net, walletNames }) {
  const { counterparty } = row;
  const name = duskNameOf(row);
  const contact = counterparty ? contactNames?.get(counterparty) : undefined;

  if (contact && name) {
    return `${contact} · ${name}`;
  }

  return (
    contact ??
    name ??
    (counterparty
      ? (walletNames?.get(counterparty) ?? routeLabel(net, counterparty))
      : null) ??
    ""
  );
}

/**
 * The title of a row with someone on the other side: what it's called, the
 * call, or the short address.
 *
 * @param {ActivityRow} row
 * @param {ActivityIcon} icon
 * @param {PresentContext} context
 * @returns {{ title: string, titleIsAddress: boolean, verb: string }}
 */
function counterpartyTitle(row, icon, context) {
  const verb = row.direction === "in" ? "Received" : "Sent";
  const named = nameOf(row, context);

  if (named) {
    return { title: named, titleIsAddress: false, verb };
  }

  if (icon === "call") {
    return {
      title: row.fnName
        ? `Called ${displayText(row.fnName).text}`
        : "Contract call",
      titleIsAddress: false,
      verb: "Contract",
    };
  }

  return row.counterparty
    ? { title: shortAddress(row.counterparty), titleIsAddress: true, verb }
    : { title: verb, titleIsAddress: false, verb };
}

/**
 * The status a row shows: only while it isn't final, or when it failed. A
 * row the chain has is final: only its outcome isn't looked up yet.
 *
 * @param {ActivityRow} row
 * @returns {ActivityShownStatus}
 */
const shownStatus = (row) =>
  row.status === "failed" || row.status === "pending"
    ? row.status
    : row.status === "unknown" && row.source === "sent"
      ? "unknown"
      : null;

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
  const { locale } = context;
  const icon = iconOf(row);
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
    category: row.category,
    counterparty: bridge?.to ?? row.counterparty,
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
  row.fee !== null ? `fee ${formatFee(row.fee, locale)} DUSK paid` : "no fee";

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
  const lux = bridge?.amount ?? row.value;
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
 * Where a proved withdrawal is: claimed by a claim in the history, or as
 * the chain says, once that has been read.
 *
 * @param {NonNullable<ActivityRow["bridge"]>} bridge
 * @param {PresentContext["claims"]} claims
 * @returns {WithdrawalStep}
 */
function withdrawalOf(bridge, claims) {
  const read = bridge.hash ? claims?.get(bridge.hash) : undefined;

  return {
    claim: read?.at
      ? { at: read.at, exact: read.exact, overdue: read.overdue }
      : null,
    claimed: bridge.claimed || Boolean(read?.claimed),
    ready: Boolean(read?.ready),
    reprove: Boolean(read?.reprove),
  };
}

/**
 * What a bridge call adds to its row, once its call is read: the DuskEVM
 * address a deposit went to, or the amount a withdrawal's proof or claim is
 * for (only where the transaction itself moved none of it), and where a
 * proved withdrawal is.
 *
 * @param {ActivityRow} row
 * @param {PresentContext} context
 * @returns {{ amount?: bigint, line?: string, to?: string, withdrawal?: WithdrawalStep } | null}
 */
function bridgeOf({ bridge, value }, { claims, locale }) {
  if (!bridge || (bridge.amount === null && !bridge.to)) {
    return null;
  }

  if (bridge.to) {
    return { line: `to ${shortAddress(bridge.to)}`, to: bridge.to };
  }

  const amount = value === 0n ? (bridge.amount ?? 0n) : undefined;

  if (bridge.step !== "proof") {
    return { amount };
  }

  const withdrawal = withdrawalOf(bridge, claims);

  return { amount, line: withdrawalLine(withdrawal, locale), withdrawal };
}

/**
 * Whether a row answers the filters.
 *
 * @param {ActivityPresentation} presentation
 * @param {ActivityRow} row
 * @param {{ kind?: ActivityKindFilter, privacy?: ActivityPrivacyFilter, since?: number | null }} filters
 */
export const matchesFilters = (
  presentation,
  row,
  { kind = "all", privacy = "all", since = null }
) =>
  (kind === "all" ||
    presentation.category === kind ||
    // What's bridged was sent or received too.
    (presentation.category === "bridge" &&
      ((kind === "sent" && row.direction === "out") ||
        (kind === "received" && row.direction === "in")))) &&
  (privacy === "all" || presentation.privacy.toLowerCase() === privacy) &&
  // A row with no time yet isn't in a range of days.
  (since === null || (row.time !== null && row.time >= since));

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
 * "2:32 PM"; to the second with `seconds`, "14:32:05".
 *
 * @param {number} time
 * @param {string} locale
 * @param {{ seconds?: boolean }} [options]
 */
export function timeLabel(time, locale, { seconds = false } = {}) {
  const { english, hourCycle, numberingSystem } = clockOf(locale);
  const h24 = hourCycle === "h23" || hourCycle === "h24";

  return new Intl.DateTimeFormat(english ? locale : "en-US", {
    hour: h24 ? "2-digit" : "numeric",
    hourCycle,
    minute: "2-digit",
    numberingSystem,
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(time);
}

/**
 * A full date and time with its time zone, in English on the locale's
 * clock: "Mon 26 Oct 2026, 14:32 CET"; to the second with `seconds`.
 *
 * @param {number} time
 * @param {string} locale
 * @param {{ seconds?: boolean }} [options]
 */
export const fullDateTime = (time, locale, { seconds = false } = {}) =>
  formatTime(time, { date: "full", locale: locale || undefined, seconds });

/**
 * When a payment was made, to the second, as a sentence says it after what
 * was paid: "today, 16:42:05 SGT", "yesterday, …" or "on 5 Nov, …". Two in
 * the same minute read apart, as a request's payments do.
 *
 * @param {number} time
 * @param {string} locale
 */
export function paidInSentence(time, locale) {
  const label = formatTime(time, {
    locale: locale || undefined,
    seconds: true,
  });

  return /^(Today|Yesterday),/.test(label)
    ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : `on ${label}`;
}
