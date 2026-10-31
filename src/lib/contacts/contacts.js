/**
 * Contacts: names for the addresses this wallet sends to, kept only on this
 * device, in the shape of the extension's address book. A contact saved
 * from a `.dusk` name keeps that name, and when it last pointed to the
 * contact's address: Send asks before it uses another address for it.
 *
 * They are the wallet's own: kept encrypted, in a place of their own
 * (contactsVault.js), and readable only while the wallet is unlocked, when
 * `openContacts` has the key. While it's locked there are none, and
 * nothing that changes them works.
 *
 * Contacts kept in plain text before move into the wallet's record the
 * first time it opens, and the plain copy goes. Removing a wallet deletes
 * its own; Reset deletes them all.
 *
 * Every change of what's kept, and Reset, takes the same lock across this
 * browser's tabs, so one tab never writes over another's change, and none
 * brings back what Reset deleted.
 */

import { ProfileGenerator } from "@dusk/w3sper";
import { writable } from "svelte/store";

import {
  contactsNamespace,
  deriveContactsKey,
  sealContacts,
  unsealContacts,
} from "./contactsVault";

/** The most contacts kept: past it, the least recently changed go. */
const LIMIT = 200;

/** The records of the wallets' contacts, by their place. */
const STORAGE_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-encrypted-contacts`;

/** Where contacts were kept in plain text before. */
const PLAIN_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`;

/**
 * A new mark each time the contacts kept are reset, or another wallet's
 * removed: a change begun before then is dropped, in any tab.
 */
const RESET_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts-reset`;

/**
 * A new mark for a wallet's place each time that wallet is removed: a
 * change of its contacts begun before then is dropped, in any tab.
 */
const GONE_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts-gone`;

/** How many times a change is tried while other tabs write without the lock. */
const TRIES = 3;

/** @returns {string | null} */
const readReset = () => localStorage.getItem(RESET_KEY);

/**
 * The mark of a wallet's place since it was last removed: null for none.
 *
 * @param {string} namespace
 * @returns {string | null}
 */
function readGone(namespace) {
  const marks = readJson(GONE_KEY);
  const mark =
    typeof marks === "object" && marks !== null
      ? /** @type {Record<string, unknown>} */ (marks)[namespace]
      : null;

  return typeof mark === "string" ? mark : null;
}

/**
 * Whether the contacts opened as `opened` were reset, or their wallet
 * removed, since.
 *
 * @param {Vault} opened
 */
const isStale = (opened) =>
  readReset() !== opened.reset || readGone(opened.namespace) !== opened.gone;

/**
 * Runs a task alone across this browser's tabs: under the contacts' lock,
 * where the browser has Web Locks.
 *
 * @template T
 * @param {() => Promise<T> | T} task
 * @returns {Promise<T>}
 */
const alone = async (task) =>
  navigator.locks?.request
    ? navigator.locks.request(STORAGE_KEY, task)
    : task();

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

/**
 * The contacts in a parsed book, without anything else.
 *
 * @param {unknown} parsed
 * @returns {Record<string, Contact>}
 */
const contactsIn = (parsed) =>
  Object.fromEntries(
    Object.entries(
      typeof parsed === "object" && parsed !== null ? parsed : {}
    ).filter(([, value]) => isContact(value))
  );

/**
 * @param {string} key
 * @returns {unknown}
 */
function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/** @returns {Record<string, unknown>} */
const readRecords = () => {
  const records = readJson(STORAGE_KEY);

  return typeof records === "object" && records !== null
    ? /** @type {Record<string, unknown>} */ (records)
    : {};
};

/** @param {Record<string, unknown>} records */
function writeRecords(records) {
  if (Object.keys(records).length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * The most recently changed contacts, up to LIMIT.
 *
 * @param {Record<string, Contact>} all
 * @returns {Record<string, Contact>}
 */
const kept = (all) =>
  Object.fromEntries(
    Object.values(all)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LIMIT)
      .map((contact) => [contact.id, contact])
  );

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

/**
 * A wallet's key, its place, and the reset and removal marks when its
 * contacts opened.
 *
 * @typedef {{ gone: string | null, key: CryptoKey, namespace: string, reset: string | null }} Vault
 */

/**
 * The unlocked wallet's key and place, while its contacts are open.
 *
 * @type {Vault | null}
 */
let vault = null;

/** The open contacts, by ID: none while the wallet is locked. */
/** @type {Record<string, Contact>} */
let book = {};

/** New each time the contacts open or close: an open begun before is dropped. */
let session = 0;

/** The changes being kept, one after the other. */
/** @type {Promise<void>} */
let writes = Promise.resolve();

/** How many changes were made: only the last one's copy, as kept, shows. */
let changes = 0;

/**
 * The open wallet's book as kept: none yet is empty. Throws when the record
 * doesn't open with the wallet's key.
 *
 * @param {Vault} opened
 * @returns {Promise<Record<string, Contact>>}
 */
async function readBook(opened) {
  const record = readRecords()[opened.namespace];

  return record === undefined
    ? {}
    : contactsIn(
        JSON.parse(await unsealContacts(opened.key, opened.namespace, record))
      );
}

/** A change to try again: another tab wrote while it was made. */
const AGAIN = Symbol("again");

/**
 * Makes a change on the book kept, and keeps it encrypted, alone across
 * tabs. Where another tab wrote meanwhile without the lock, it's tried
 * again. Nothing is kept once the contacts were reset since they opened:
 * that gives null.
 *
 * @param {Vault} opened
 * @param {(all: Record<string, Contact>) => { all: Record<string, Contact> }} apply
 * @param {() => void} [whenKept] What to do once it's kept, still alone
 * @returns {Promise<Record<string, Contact> | null>} The book kept
 */
async function keepChange(opened, apply, whenKept) {
  for (let tries = 0; tries < TRIES; tries++) {
    const done = await alone(async () => {
      if (isStale(opened)) {
        return null;
      }

      const before = localStorage.getItem(STORAGE_KEY);
      const next = kept(apply(await readBook(opened)).all);
      const record = await sealContacts(
        opened.key,
        opened.namespace,
        JSON.stringify(next)
      );

      if (localStorage.getItem(STORAGE_KEY) !== before || isStale(opened)) {
        return AGAIN;
      }

      writeRecords({ ...readRecords(), [opened.namespace]: record });
      whenKept?.();

      return next;
    });

    if (done !== AGAIN) {
      return done;
    }
  }

  throw new Error("Other tabs kept changing the contacts.");
}

/** The contacts, sorted, as they change here or in another tab. */
const store = writable(/** @type {Contact[]} */ ([]), () => {
  /** @param {StorageEvent} event */
  const onStorage = (event) => {
    if (vault && isStale(vault)) {
      // Reset, another wallet restored, or this one removed, in another tab.
      closeContacts();
    } else if (vault && (event.key === STORAGE_KEY || event.key === null)) {
      const opened = vault;
      const changed = changes;

      // After the changes made here, and unless one is made meanwhile: the
      // book kept is then the latest.
      writes = writes
        .then(() => readBook(opened))
        .then((latest) => {
          if (vault === opened && changed === changes) {
            show(latest);
          }
        })
        .catch(() => {
          if (vault === opened) {
            closeContacts();
          }
        });
    }
  };

  window.addEventListener("storage", onStorage);

  return () => window.removeEventListener("storage", onStorage);
});

export const contactsStore = { subscribe: store.subscribe };

/** @param {Record<string, Contact>} next */
function show(next) {
  book = next;
  store.set(sorted(book));
}

/**
 * Changes the contacts: at once on screen, then on the latest kept copy,
 * one change at a time and alone across tabs, so that one made in another
 * tab stays. A copy that doesn't open with the wallet's key, or contacts
 * reset since they opened, close the contacts, and nothing is written.
 *
 * @template T
 * @param {(all: Record<string, Contact>) => { all: Record<string, Contact>, value: T }} apply
 *   A change that depends only on the contacts it's given
 * @param {() => void} [whenKept] What to do once the change is kept
 * @returns {T}
 */
function change(apply, whenKept) {
  const opened = vault;

  if (!opened) {
    throw new Error("Contacts open with the wallet: unlock it first.");
  }

  const now = apply(book);

  if (now.all === book) {
    return now.value;
  }

  const thisChange = ++changes;

  show(kept(now.all));
  writes = writes
    .then(async () => {
      const next = await keepChange(opened, apply, whenKept);

      if (vault !== opened) {
        return;
      }

      // Reset meanwhile: none show. Else the last change shows the copy
      // kept, with another tab's changes.
      if (next === null) {
        closeContacts();
      } else if (thisChange === changes) {
        show(next);
      }
    })
    .catch(() => {
      if (vault === opened) {
        closeContacts();
      }
    });

  return now.value;
}

/**
 * A wallet's key and place, as its contacts open.
 *
 * @param {string} account Its first public account
 * @param {Uint8Array} seed
 * @returns {Promise<Vault>}
 */
async function vaultOf(account, seed) {
  const key = await deriveContactsKey(seed);
  const namespace = await contactsNamespace(account);

  return { gone: readGone(namespace), key, namespace, reset: readReset() };
}

/**
 * Opens the contacts of the wallet that is unlocking, with its seed: those
 * it kept, and those kept in plain text before, which move into its record.
 * A record that doesn't open with its key stays as it is, and the contacts
 * stay closed.
 *
 * @param {{ account: string, seed: Uint8Array }} wallet Its first public
 *   account and its seed
 * @returns {Promise<boolean>} Whether they opened
 */
export async function openContacts({ account, seed }) {
  closeContacts();

  const opening = session;

  try {
    // What was changed before is kept first.
    await writes;

    const opened = await vaultOf(account, seed);
    const own = await readBook(opened);

    if (opening !== session) {
      return false;
    }

    vault = opened;
    show(own);
    await moveInPlainContacts();

    return vault === opened;
  } catch {
    if (opening === session) {
      closeContacts();
    }

    return false;
  }
}

/**
 * Moves contacts kept in plain text, if any, into the open wallet's record,
 * its own winning, and deletes the plain copy once the record holding them
 * is kept. Nothing to move still deletes the copy.
 */
async function moveInPlainContacts() {
  if (localStorage.getItem(PLAIN_KEY) === null) {
    return;
  }

  const plain = contactsIn(readJson(PLAIN_KEY));

  change(
    (all) => ({ all: { ...plain, ...all }, value: null }),
    () => localStorage.removeItem(PLAIN_KEY)
  );
  await writes;
}

/** Closes the contacts, as the wallet locks: none show until it unlocks. */
export function closeContacts() {
  session++;
  vault = null;
  show({});
}

/**
 * Deletes every wallet's contacts on this device, encrypted or in plain
 * text, as Reset does: alone across tabs, and a change begun before is
 * dropped in any of them.
 *
 * @returns {Promise<void>}
 */
export function deleteContacts() {
  closeContacts();

  return alone(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PLAIN_KEY);
    localStorage.removeItem(GONE_KEY);
    localStorage.setItem(RESET_KEY, newId());
  });
}

/**
 * Deletes one wallet's contacts, as it's removed: alone across tabs, and a
 * change of them begun before is dropped in any of them. Another wallet's
 * stay as they are, and open.
 *
 * @param {string} account The wallet's first public account
 * @returns {Promise<void>}
 */
export async function forgetContactsOf(account) {
  const namespace = await contactsNamespace(account);

  if (vault?.namespace === namespace) {
    closeContacts();
  }

  await alone(() => {
    const rest = readRecords();
    const marks = readJson(GONE_KEY);

    delete rest[namespace];
    writeRecords(rest);
    localStorage.setItem(
      GONE_KEY,
      JSON.stringify({
        ...(typeof marks === "object" && marks !== null ? marks : {}),
        [namespace]: newId(),
      })
    );
  });
}

/**
 * Keeps only one wallet's contacts on this device, as it's restored or
 * made: another wallet's go, and with `plain` false so do those kept in
 * plain text before, which then belong to no wallet this device knows.
 *
 * @param {string} account The wallet's first public account
 * @param {{ plain: boolean }} options
 */
export async function keepOnlyContactsOf(account, { plain }) {
  const namespace = await contactsNamespace(account);

  await alone(() => {
    const own = readRecords()[namespace];

    writeRecords(own === undefined ? {} : { [namespace]: own });

    if (!plain) {
      localStorage.removeItem(PLAIN_KEY);
    }

    localStorage.setItem(RESET_KEY, newId());
  });
}

/** Resolves once the changes made so far are kept. */
export const contactsWritten = () => writes;

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
  const all = sorted(book);

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
export const getContact = (id) => book[id] ?? null;

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
  const id = entry.id || newId();
  const now = Date.now();
  const address = entry.address.trim();
  const duskName = (entry.duskName ?? "").trim().toLowerCase();
  const checkedAt = Number(entry.checkedAt);

  return change((all) => {
    /** @type {Contact} */
    const contact = {
      address,
      createdAt: all[id]?.createdAt ?? now,
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

    return { all: { ...all, [id]: contact }, value: contact };
  });
}

/**
 * Whether a contact is still the one a check of its `.dusk` name was for.
 *
 * @param {Contact | undefined} current The contact as saved now
 * @param {Contact} checked The contact as the check found it
 * @returns {current is Contact}
 */
const isStillAsChecked = (current, checked) =>
  Boolean(current?.duskName) &&
  current?.name === checked.name &&
  current?.address === checked.address &&
  current?.duskName === checked.duskName;

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
  return change((all) => {
    const current = all[checked.id];

    if (!isStillAsChecked(current, checked)) {
      return { all, value: null };
    }

    // It points here again: no longer moved.
    const contact = { ...current, checkedAt };

    delete contact.movedTo;

    return { all: { ...all, [contact.id]: contact }, value: contact };
  });
}

/**
 * Notes that a contact's `.dusk` name points to another address now, or to
 * none of the contact's kind (""), on the contact as saved now and only
 * while it's the one checked. The contact keeps its address.
 *
 * @param {Contact} checked The contact as the check found it
 * @param {string} pointsTo The address the name points to now
 * @returns {Contact | null} The contact, or null when it changed
 */
export function markContactNameMoved(checked, pointsTo) {
  return change((all) => {
    const current = all[checked.id];

    if (!isStillAsChecked(current, checked)) {
      return { all, value: null };
    }

    const contact = { ...current, movedTo: pointsTo };

    return { all: { ...all, [contact.id]: contact }, value: contact };
  });
}

/** @param {string} id */
export function removeContact(id) {
  change((all) => {
    if (!all[id]) {
      return { all, value: undefined };
    }

    const rest = { ...all };

    delete rest[id];

    return { all: rest, value: undefined };
  });
}

/**
 * The contacts' names by address, for the history to show.
 *
 * @param {Contact[]} contacts
 * @returns {Map<string, string>}
 */
export const contactNamesOf = (contacts) =>
  new Map(contacts.map((contact) => [contact.address, contact.name]));
