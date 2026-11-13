/**
 * Sends that never went out, said with what Send showed of them, to send
 * again through Review or to drop: none is ever sent by itself.
 *
 * Each send made on Send is kept on this device from the moment it's sent
 * until it's handed to the node, the person calls it off, or its own screen
 * says it failed. One whose page closed, reloaded or locked before then went
 * nowhere, and stays kept: that's one of these. What's kept is what Send
 * showed of it and what its form held, never a password or a key, nor a memo
 * that reads as a recovery phrase.
 *
 * A send still waiting in another tab isn't one: that tab holds a lock named
 * after it (Web Locks) while it waits, and writes it only once it holds it.
 * The lock goes with the tab. Each wallet's are kept under its own names
 * ($lib/wallets/dataNames).
 *
 * `${APP_KEY}-unsent-sends`: [{ account, at, id, label, lux, memo, network,
 * to, typed }]
 */

import { derived, get, writable } from "svelte/store";

import validateMnemonic from "$lib/wallet/validateMnemonic";
import { walletDataScope } from "$lib/wallets/dataNames";
import {
  changeRecords,
  openRecords,
  walletRecords,
} from "$lib/wallets/walletRecords";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-unsent-sends`;

/** The lock a tab holds while one of its sends is being sent. */
const LOCK = `${CONFIG.LOCAL_STORAGE_APP_KEY}-sending:`;

/**
 * A send kept until it goes out.
 *
 * @typedef {{
 *   account: string,
 *   at: number,
 *   id: string,
 *   label: string,
 *   lux: string,
 *   memo: string,
 *   network: string,
 *   to: string,
 *   typed: Record<string, unknown>,
 * }} UnsentSend
 *   `account` the public account of the profile it goes from; `label` whom it
 *   goes to, as Send said it ("your Profile 2"); `lux` its amount; `to` the
 *   address it goes to; `typed` what Send's form held, to fill it in again.
 */

/** @param {any} kept */
const isUnsent = (kept) =>
  Boolean(kept) &&
  typeof kept === "object" &&
  ["account", "id", "label", "memo", "network", "to"].every(
    (field) => typeof kept[field] === "string"
  ) &&
  typeof kept.at === "number" &&
  typeof kept.lux === "string" &&
  /^\d+$/.test(kept.lux) &&
  Boolean(kept.typed) &&
  typeof kept.typed === "object";

/** @type {import("svelte/store").Writable<UnsentSend[]>} */
const kept = writable([]);

const records = walletRecords({
  keyOf: (/** @type {UnsentSend} */ send) => send.id,
  name: KEY,
  /** @returns {UnsentSend[]} */
  read(scope) {
    try {
      const list = JSON.parse(localStorage.getItem(scope.name(KEY)) ?? "null");

      return Array.isArray(list) ? list.filter(isUnsent) : [];
    } catch {
      return [];
    }
  },
  store: kept,
});

/** Shows the open wallet's, as it opens. */
export const hydrateUnsentSends = () => openRecords(records);

/**
 * Forgets one wallet's, as it's removed, by the ending of its names.
 *
 * @param {string} suffix
 */
export function forgetWalletUnsentSends(suffix) {
  try {
    localStorage.removeItem(`${KEY}${suffix}`);
  } catch {
    // Nothing is kept where storage can't be read.
  }
}

/** The sends this tab is sending: none of them is unsent while it is. */
const sending = new Set();

/** The sends no tab is sending: those of them still kept never went out. */
const over = writable(/** @type {Set<string>} */ (new Set()));

/** The sends whose lock is asked for, to know whether a tab sends them. */
const asking = new Set();

/** @param {string} id */
const isOver = (id) => over.update((ids) => new Set(ids).add(id));

/**
 * Finds out whether another tab sends `id`: once its lock is free, as the
 * send went out, was called off, or its tab went, none does. It never went
 * out where storage keeps it still then: a tab forgets one that went out
 * before its lock goes.
 *
 * @param {string} id
 */
function ask(id) {
  if (sending.has(id) || asking.has(id) || get(over).has(id)) {
    return;
  }

  const { locks } = navigator;

  // Without locks, no other tab can be asked: what's kept is said.
  if (!locks?.request) {
    isOver(id);

    return;
  }

  const scope = walletDataScope();
  let isKept = true;

  asking.add(id);
  locks
    .request(`${LOCK}${id}`, () => {
      isKept = records.read(scope).some((send) => send.id === id);
    })
    .catch(() => {})
    .finally(() => {
      asking.delete(id);

      if (isKept) {
        isOver(id);
      }
    });
}

kept.subscribe((list) => {
  for (const { id } of list) {
    ask(id);
  }
});

/**
 * The open wallet's sends that never went out, the oldest first: those of
 * the network it's on are for its screens to say.
 *
 * @type {import("svelte/store").Readable<UnsentSend[]>}
 */
export const unsentSends = derived([kept, over], ([list, ids]) =>
  list
    .filter(({ id }) => ids.has(id) && !sending.has(id))
    .sort((a, b) => a.at - b.at)
);

/**
 * What's kept of a send: no memo that reads as a recovery phrase, as one
 * pasted there by mistake, in what it shows or in what its form held.
 *
 * @param {UnsentSend} send
 * @returns {UnsentSend}
 */
function keptOf(send) {
  /** @param {unknown} value */
  const isPhrase = (value) =>
    typeof value === "string" && validateMnemonic(value.trim());

  return {
    ...send,
    memo: isPhrase(send.memo) ? "" : send.memo,
    typed: Object.fromEntries(
      Object.entries(send.typed).map(([name, value]) => [
        name,
        isPhrase(value) ? "" : value,
      ])
    ),
  };
}

/**
 * Keeps a send as it's sent, for the wallet open now, until it ends: then
 * `end(true)` leaves it kept, as one that never went out, and `end(false)`
 * forgets it. While it's being sent, this tab holds its lock, and it's
 * written only once the tab does: no other tab finds it kept with its lock
 * free while it's being sent. Storage says what's left of it before the lock
 * goes.
 *
 * @param {UnsentSend} send
 * @returns {(keep: boolean) => void} Ends it
 */
export function keepUnsent(send) {
  const scope = walletDataScope();
  const record = keptOf(send);
  let isEnded = false;
  let isWritten = false;

  /** @type {(value?: unknown) => void} */
  let release = () => {};

  const released = new Promise((resolve) => {
    release = resolve;
  });

  const write = () => {
    if (!isWritten) {
      isWritten = true;
      changeRecords(records, scope, (list) => [
        ...list.filter(({ id }) => id !== record.id),
        record,
      ]);
    }
  };

  sending.add(record.id);

  const { locks } = navigator;

  if (locks?.request) {
    locks
      .request(`${LOCK}${record.id}`, () => {
        if (!isEnded) {
          write();
        }

        return released;
      })
      .catch(() => {
        // Not held: kept all the same, as it would be without locks.
        if (!isEnded) {
          write();
        }
      });
  } else {
    write();
  }

  return (keep) => {
    if (isEnded) {
      return;
    }

    isEnded = true;
    sending.delete(record.id);

    if (keep) {
      write();
      isOver(record.id);
    } else if (isWritten) {
      changeRecords(records, scope, (list) =>
        list.filter(({ id }) => id !== record.id)
      );
    }

    release();
  };
}

/**
 * Forgets the open wallet's sends that never went out that are the same as
 * one made now: the same amount, from the same profile, to the same address,
 * with the same memo. Made again, it's no longer one to say.
 *
 * @param {Pick<UnsentSend, "account" | "lux" | "memo" | "network" | "to">} send
 */
export function forgetSameUnsent({ account, lux, memo, network, to }) {
  const same = get(unsentSends).filter(
    (kept) =>
      kept.account === account &&
      kept.lux === lux &&
      kept.memo === memo &&
      kept.network === network &&
      kept.to === to
  );

  if (same.length) {
    changeRecords(records, walletDataScope(), (list) =>
      list.filter((kept) => !same.some(({ id }) => id === kept.id))
    );
  }
}

/**
 * Drops a send that never went out, as the person chooses not to send it.
 *
 * @param {string} id
 */
export function dropUnsent(id) {
  changeRecords(records, walletDataScope(), (list) =>
    list.filter((kept) => kept.id !== id)
  );
}

/** @type {import("svelte/store").Writable<UnsentSend | null>} */
const refills = writable(null);

/** A send that never went out, for Send to fill its form in with: null for none. */
export const unsentRefill = { subscribe: refills.subscribe };

/**
 * Asks Send to fill its form in with a send that never went out, to be
 * reviewed: it goes off the list as Send takes it (`takeUnsentRefill`).
 *
 * @param {UnsentSend} send
 */
export function sendUnsentAgain(send) {
  refills.set(send);
}

/**
 * The send Send was asked to fill its form in with, once, off the list now:
 * null for none, or for one of another profile's or network's than the one
 * Send sends from.
 *
 * @param {{ account: string, network: string }} sender
 * @returns {UnsentSend | null}
 */
export function takeUnsentRefill({ account, network }) {
  const send = get(refills);

  if (!send) {
    return null;
  }

  refills.set(null);

  if (send.account !== account || send.network !== network) {
    return null;
  }

  dropUnsent(send.id);

  return send;
}
