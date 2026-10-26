/**
 * What the search finds on this device: the wallet's pages and actions, its
 * profiles, the people in its history and its transactions. Nothing here
 * asks the network.
 */

import { ProfileGenerator } from "@dusk/w3sper";

import { describeRow, shortAddress } from "$lib/activity/present";

/**
 * @typedef {{
 *   detail?: string,
 *   detailIsCode?: boolean,
 *   external?: boolean,
 *   group: "Pages" | "People" | "Transactions" | "Your profiles",
 *   href?: string,
 *   id: string,
 *   label: string,
 *   labelIsCode?: boolean,
 *   value?: string,
 * }} SearchResult
 *
 * @typedef {{
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
export function searchLocally(query, { history, locale, pages, profiles }) {
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
    peopleOf(history, locale)
      .filter((person) => has(`${person.name} ${person.address}`, q))
      .map((person) => ({
        detail: person.name ? shortAddress(person.address) : undefined,
        detailIsCode: true,
        group: "People",
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
 * What a query that found nothing here can be looked up as, on Enter.
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

  return ProfileGenerator.typeOf(q) === "undefined" ? null : "address";
}
