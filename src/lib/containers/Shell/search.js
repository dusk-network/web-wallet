/**
 * What the search finds on this device: the wallet's pages and actions, its
 * profiles, its contacts, the people in its history and its transactions, by
 * hash, memo, amount, who they're with or the label of their contract or
 * account, and a block by its height. Nothing here asks the network.
 */

import { ProfileGenerator } from "@dusk/w3sper";
import { amountsMeant } from "@dusk-network/app-core/amounts";
import { searchKey } from "@dusk-network/app-core/text";
import { labelFor, networks } from "@dusk-network/networks";
import { asDuskName, isDuskName } from "@duskdomains/sdk/names";

import { BALANCE_MASK } from "$lib/constants/balanceMask";

import { contractLabel } from "$lib/activity/knownContracts";
import { contactNameText } from "$lib/contacts";
import {
  dayLabel,
  describeRow,
  shortAddress,
  timeLabel,
} from "$lib/activity/present";

/**
 * @typedef {{
 *   block?: string,
 *   detail?: string,
 *   detailIsCode?: boolean,
 *   external?: boolean,
 *   group: "Blocks" | "Contacts" | "Pages" | "People" | "Transactions" | "Your profiles",
 *   hint?: string,
 *   href?: string,
 *   id: string,
 *   label: string,
 *   labelIsCode?: boolean,
 *   sub?: string,
 *   value?: string,
 * }} SearchResult
 *   `block` a block's height, which the explorer is opened at; `sub` a
 *   second line, as when a transaction was made.
 *
 * @typedef {{
 *   contacts?: Contact[],
 *   hideBalances?: boolean,
 *   history: ActivityRow[],
 *   locale: string,
 *   network?: string,
 *   pages: { href: string, keywords?: string, label: string }[],
 *   present?: Omit<import("$lib/activity/present").PresentContext, "locale">,
 *   profiles: { account: string, address: string, label: string, name: string }[],
 * }} SearchIndex
 *   `present` what the history's rows are told by, as History tells them.
 */

/** The most results a group shows. */
export const GROUP_LIMIT = 5;

/**
 * Whether a field holds what's typed, whatever its accents and case.
 *
 * @param {string} haystack
 * @param {string} needle As `searchKey` makes it
 */
const has = (haystack, needle) => searchKey(haystack).includes(needle);

/**
 * What a row is known by besides its hash: its memo, and the labels of its
 * contract and its counterparty, as the network's file names them.
 *
 * @param {ActivityRow} row
 * @param {string} network
 */
function knownBy(row, network) {
  const net = Object.hasOwn(networks, network)
    ? networks[/** @type {keyof typeof networks} */ (network)]
    : null;

  return [
    row.memo,
    contractLabel(row.contractId, network),
    net && row.counterparty ? labelFor(net, row.counterparty) : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The people of the history: the counterparties, with their names, most
 * recent first.
 *
 * @param {ActivityRow[]} history
 * @param {string} locale
 */
function peopleOf(history, locale) {
  /** @type {Map<string, { address: string, name: string }>} */
  const people = new Map();

  for (const row of history) {
    const { counterparty } = describeRow(row, { locale });

    if (
      counterparty &&
      !people.has(counterparty) &&
      ProfileGenerator.typeOf(counterparty) !== "undefined"
    ) {
      people.set(counterparty, {
        address: counterparty,
        name: row.counterpartyName ?? row.toName ?? "",
      });
    }
  }

  return [...people.values()];
}

/**
 * Whether a query reads as an amount of DUSK, as app-core's `amountsMeant`
 * reads one: "0.2" and "0,2" alike.
 *
 * @param {string} query
 * @param {string} locale
 */
export const isAmountQuery = (query, locale) =>
  amountsMeant(query, locale).length > 0;

/**
 * What a row moved, as it shows it: what a withdrawal's proof or claim is for,
 * where the transaction itself moved none of it.
 *
 * @param {ActivityRow} row
 */
const luxOf = ({ bridge, value }) =>
  value === 0n ? (bridge?.amount ?? 0n) : value;

/**
 * Whether a query is a row's hash, or the start of it.
 *
 * @param {ActivityRow} row
 * @param {string} q As `searchKey` makes it
 */
const isHash = (row, q) => q.length >= 4 && row.hash.includes(q);

/**
 * The transactions a query finds, as the search finds them, every one: by
 * hash, by what they're known by, by amount and by who they're with, those of
 * the contacts the query names and whoever History names so. The amount
 * typed, to the lux, comes first; the rest in the history's order. History
 * shows the same, for a search's See all.
 *
 * @param {string} query
 * @param {Pick<SearchIndex, "contacts" | "history" | "locale" | "network" | "present">} index
 * @returns {{ row: ActivityRow, shown: import("$lib/activity/present").ActivityPresentation }[]}
 */
export function transactionsFound(
  query,
  { contacts = [], history, locale, network = "", present = {} }
) {
  const q = searchKey(query);

  if (!q) {
    return [];
  }

  const amounts = amountsMeant(query, locale);
  const foundPeople = new Set(
    contacts
      .filter((c) => has(`${c.name} ${c.duskName ?? ""} ${c.address}`, q))
      .map(({ address }) => address)
  );

  /** @param {ActivityRow} row */
  const hasAmountMeant = (row) => {
    const lux = luxOf(row);

    return amounts.some(({ from, to }) => lux >= from && lux < to);
  };

  return (
    history
      .map((row) => ({
        row,
        shown: describeRow(row, { ...present, locale }),
      }))
      .filter(
        ({ row, shown }) =>
          isHash(row, q) ||
          (q.length >= 3 &&
            has(`${knownBy(row, network)} ${shown.title}`, q)) ||
          (q.length >= 4 && has(shown.counterparty ?? "", q)) ||
          foundPeople.has(shown.counterparty ?? "") ||
          hasAmountMeant(row)
      )
      // The amount typed, to the lux, before those that only start with it.
      .sort(
        (a, b) =>
          Number(amounts.some(({ from }) => luxOf(b.row) === from)) -
          Number(amounts.some(({ from }) => luxOf(a.row) === from))
      )
  );
}

/**
 * The results for a query, by group, at most GROUP_LIMIT each.
 *
 * @param {string} query
 * @param {SearchIndex} index
 * @returns {SearchResult[]}
 */
export function searchLocally(
  query,
  {
    contacts = [],
    hideBalances = false,
    history,
    locale,
    network = "",
    pages,
    present = {},
    profiles,
  }
) {
  const q = searchKey(query);

  /** @type {SearchResult[]} */
  const results = [];

  if (!q) {
    return pages.slice(0, GROUP_LIMIT).map((page) => ({
      group: "Pages",
      href: page.href,
      id: `page:${page.href}`,
      label: page.label,
    }));
  }

  /**
   * @param {SearchResult[]} found
   */
  const add = (found) => results.push(...found.slice(0, GROUP_LIMIT));

  add(
    pages
      .filter((page) => has(`${page.label} ${page.keywords ?? ""}`, q))
      .map((page) => ({
        group: "Pages",
        href: page.href,
        id: `page:${page.href}`,
        label: page.label,
      }))
  );
  add(
    profiles
      .filter((p) => has(`${p.label} ${p.name} ${p.account} ${p.address}`, q))
      .map((p) => ({
        detail: shortAddress(p.account),
        detailIsCode: true,
        group: "Your profiles",
        id: `profile:${p.account}`,
        label: p.name ? `${p.label} · ${p.name}` : p.label,
        value: p.account,
      }))
  );

  const foundContacts = contacts.filter((c) =>
    has(`${c.name} ${c.duskName ?? ""} ${c.address}`, q)
  );

  add(
    foundContacts.map((contact) => ({
      detail: contact.duskName ?? shortAddress(contact.address),
      detailIsCode: !contact.duskName,
      group: "Contacts",
      href: `/dashboard/contacts?contact=${encodeURIComponent(contact.id)}`,
      id: `contact:${contact.id}`,
      label: contactNameText(contact.name),
    }))
  );

  // People saved as contacts show as contacts.
  const saved = new Set(contacts.map((contact) => contact.address));

  add(
    peopleOf(history, locale)
      .filter((person) => !saved.has(person.address))
      .filter((person) => has(`${person.name} ${person.address}`, q))
      .map((person) => ({
        detail: person.name ? shortAddress(person.address) : undefined,
        detailIsCode: true,
        group: "People",
        hint: "Send",
        href: `/dashboard/send?to=${encodeURIComponent(person.address)}`,
        id: `person:${person.address}`,
        label: person.name || shortAddress(person.address),
        labelIsCode: !person.name,
        value: person.address,
      }))
  );

  // The transactions by what they're known by, by amount and by who they're
  // with: those of the contacts found, and whoever History names so.
  const transactions = transactionsFound(query, {
    contacts,
    history,
    locale,
    network,
    present,
  });

  add(
    transactions.map(({ row, shown }) => {
      // Named as History names it, with when it was made under it, and
      // what it moved unless it's found by its hash.
      const { amount, title, titleIsAddress } = shown;
      const byHash = isHash(row, q);

      return {
        detail: byHash
          ? shortAddress(row.hash)
          : `${amount.sign}${hideBalances ? BALANCE_MASK : amount.text} DUSK`,
        detailIsCode: byHash,
        group: /** @type {const} */ ("Transactions"),
        href: `/dashboard/transactions?tx=${row.hash}`,
        id: `tx:${row.hash}`,
        label: title,
        labelIsCode: titleIsAddress,
        sub:
          row.time === null
            ? undefined
            : `${dayLabel(row.time, { locale })}, ${timeLabel(row.time, locale)}`,
        value: row.hash,
      };
    })
  );

  // The rest, in History, where the group can't show them all.
  if (transactions.length > GROUP_LIMIT) {
    results.push({
      group: "Transactions",
      href: `/dashboard/transactions?q=${encodeURIComponent(query.trim())}`,
      id: "tx:all",
      label: `See all ${transactions.length} in History`,
    });
  }

  // A block, by its height.
  if (/^\d{1,15}$/.test(q)) {
    const height = BigInt(q).toString();

    results.push({
      block: height,
      external: true,
      group: "Blocks",
      id: `block:${height}`,
      label: `Open block ${BigInt(height).toLocaleString(locale)} in the explorer`,
    });
  }

  return results;
}

/**
 * What a query that found nothing here can be looked up as, on Enter: a
 * name typed without .dusk, as "alice", is looked up as alice.dusk.
 *
 * @param {string} query
 * @returns {"address" | "name" | "transaction" | null}
 */
export function lookupKind(query) {
  const q = query.trim();

  if (/^[^\s.]+(\.[^\s.]+)*\.dusk$/i.test(q)) {
    return "name";
  }

  if (/^(0x)?[0-9a-f]{64}$/i.test(q)) {
    return "transaction";
  }

  if (ProfileGenerator.typeOf(q) !== "undefined") {
    return "address";
  }

  // Digits and a separator are an amount: no name anyone means.
  return /^\d[\d\s.,]*[\s.,][\d\s.,]*$/.test(q) || !asDuskName(q)
    ? null
    : "name";
}

/**
 * The `.dusk` name a query is looked up as: the one typed, or the one a
 * name typed without .dusk means.
 *
 * @param {string} query
 * @returns {string}
 */
export const lookupName = (query) =>
  (isDuskName(query) ? null : asDuskName(query)) ?? query.trim();
