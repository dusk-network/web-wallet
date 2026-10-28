/**
 * What the search finds on this device: the wallet's pages and actions, its
 * profiles, its contacts, the people in its history and its transactions.
 * Nothing here asks the network.
 */

import { ProfileGenerator } from "@dusk/w3sper";

import { describeRow, shortAddress } from "$lib/activity/present";
import { asDuskName, isDuskName } from "$lib/dusk-domains";

/**
 * @typedef {{
 *   detail?: string,
 *   detailIsCode?: boolean,
 *   external?: boolean,
 *   group: "Contacts" | "Pages" | "People" | "Transactions" | "Your profiles",
 *   hint?: string,
 *   href?: string,
 *   id: string,
 *   label: string,
 *   labelIsCode?: boolean,
 *   value?: string,
 * }} SearchResult
 *
 * @typedef {{
 *   contacts?: Contact[],
 *   history: ActivityRow[],
 *   locale: string,
 *   pages: { href: string, keywords?: string, label: string }[],
 *   profiles: { account: string, address: string, label: string, name: string }[],
 * }} SearchIndex
 */

/** The most results a group shows. */
export const GROUP_LIMIT = 5;

/**
 * @param {string} haystack
 * @param {string} needle Lower case
 */
const has = (haystack, needle) => haystack.toLowerCase().includes(needle);

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
 * The results for a query, by group, at most GROUP_LIMIT each.
 *
 * @param {string} query
 * @param {SearchIndex} index
 * @returns {SearchResult[]}
 */
export function searchLocally(
  query,
  { contacts = [], history, locale, pages, profiles }
) {
  const q = query.trim().toLowerCase();

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
  add(
    contacts
      .filter((c) => has(`${c.name} ${c.duskName ?? ""} ${c.address}`, q))
      .map((contact) => ({
        detail: contact.duskName ?? shortAddress(contact.address),
        detailIsCode: !contact.duskName,
        group: "Contacts",
        href: `/dashboard/contacts?contact=${encodeURIComponent(contact.id)}`,
        id: `contact:${contact.id}`,
        label: contact.name,
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
  add(
    history
      .filter((row) => q.length >= 4 && row.hash.includes(q))
      .map((row) => ({
        detail: describeRow(row, { locale }).title,
        group: "Transactions",
        href: `/dashboard/transactions?tx=${row.hash}`,
        id: `tx:${row.hash}`,
        label: shortAddress(row.hash),
        labelIsCode: true,
      }))
  );

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

  return asDuskName(q) ? "name" : null;
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
