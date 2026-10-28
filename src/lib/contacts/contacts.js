/**
 * Contacts: names for the addresses this wallet sends to, kept only on this
 * device, in the shape of the extension's address book. A contact saved
 * from a `.dusk` name keeps that name, and when it last pointed to the
 * contact's address: Send asks before it uses another address for it.
 */

import { ProfileGenerator } from "@dusk/w3sper";
import { writable } from "svelte/store";

/** The most contacts kept: past it, the least recently changed go. */
const LIMIT = 200;

const STORAGE_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`;

/**
 * @param {unknown} value
 * @returns {value is Contact}
 */
const isContact = (value) =>
  typeof value === "object" &&
  value !== null &&
  typeof (/** @type {any} */ (value).id) === "string" &&
  typeof (/** @type {any} */ (value).name) === "string" &&
  typeof (/** @type {any} */ (value).address) === "string";

/** @returns {Record<string, Contact>} */
function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

    return Object.fromEntries(
      Object.entries(stored ?? {}).filter(([, value]) => isContact(value))
    );
  } catch {
    return {};
  }
}

/**
 * Contacts by name, A to Z, then the most recently changed first.
 *
 * @param {Record<string, Contact>} all
 * @returns {Contact[]}
 */
const sorted = (all) =>
  Object.values(all).sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      b.updatedAt - a.updatedAt
  );

/** The contacts, sorted, as they change here or in another tab. */
const store = writable(sorted(read()), (set) => {
  /** @param {StorageEvent} event */
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      set(sorted(read()));
    }
  };

  window.addEventListener("storage", onStorage);

  return () => window.removeEventListener("storage", onStorage);
});

export const contactsStore = { subscribe: store.subscribe };

/** @param {Record<string, Contact>} all */
function write(all) {
  const kept = Object.values(all)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, LIMIT);
  const next = Object.fromEntries(kept.map((contact) => [contact.id, contact]));

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  store.set(sorted(next));
}

/** @returns {string} */
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Whether an address is a public account or a shielded address.
 *
 * @param {string} address
 * @returns {Contact["type"]}
 */
export function addressType(address) {
  const type = ProfileGenerator.typeOf(address);

  return type === "account" || type === "address" ? type : "unknown";
}

/**
 * The contacts, sorted, or those whose name, `.dusk` name or address has
 * the query.
 *
 * @param {string} [query]
 * @returns {Contact[]}
 */
export function listContacts(query = "") {
  const q = query.trim().toLowerCase();
  const all = sorted(read());

  return q
    ? all.filter((contact) =>
        [contact.name, contact.duskName ?? "", contact.address].some((value) =>
          value.toLowerCase().includes(q)
        )
      )
    : all;
}

/**
 * @param {string} id
 * @returns {Contact | null}
 */
export const getContact = (id) => read()[id] ?? null;

/**
 * The contact a recipient is: one saved with that address, or with that
 * `.dusk` name.
 *
 * @param {string} recipient An address or a `.dusk` name
 * @returns {Contact | null}
 */
export function findContact(recipient) {
  const value = recipient.trim();
  const name = value.toLowerCase();

  if (!value) {
    return null;
  }

  return (
    listContacts().find(
      (contact) => contact.address === value || contact.duskName === name
    ) ?? null
  );
}

/**
 * Saves a contact, new or changed. One saved from a `.dusk` name keeps the
 * name and when it was checked, now unless told; one saved from an address
 * alone has neither.
 *
 * @param {{
 *   address: string,
 *   checkedAt?: number | null,
 *   duskName?: string | null,
 *   id?: string,
 *   name: string,
 * }} entry
 * @returns {Contact}
 */
export function saveContact(entry) {
  const all = read();
  const id = entry.id || newId();
  const now = Date.now();
  const previous = all[id];
  const address = entry.address.trim();
  const duskName = (entry.duskName ?? "").trim().toLowerCase();
  const checkedAt = Number(entry.checkedAt);

  /** @type {Contact} */
  const contact = {
    address,
    createdAt: previous?.createdAt ?? now,
    id,
    name: entry.name.trim(),
    type: addressType(address),
    updatedAt: now,
    ...(duskName
      ? {
          checkedAt:
            Number.isFinite(checkedAt) && checkedAt > 0 ? checkedAt : now,
          duskName,
        }
      : {}),
  };

  write({ ...all, [id]: contact });

  return contact;
}

/**
 * Notes that a contact's `.dusk` name still points to its address, on the
 * contact as saved now and only while it's the one checked: a contact
 * changed or deleted during the check stays as it is.
 *
 * @param {Contact} checked The contact as the check found it
 * @param {number} [checkedAt]
 * @returns {Contact | null} The contact, or null when it changed
 */
export function markContactNameChecked(checked, checkedAt = Date.now()) {
  const all = read();
  const current = all[checked.id];

  if (
    !current?.duskName ||
    current.name !== checked.name ||
    current.address !== checked.address ||
    current.duskName !== checked.duskName
  ) {
    return null;
  }

  const contact = { ...current, checkedAt };

  write({ ...all, [contact.id]: contact });

  return contact;
}

/** @param {string} id */
export function removeContact(id) {
  const all = read();

  if (all[id]) {
    delete all[id];
    write(all);
  }
}
