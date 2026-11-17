/**
 * Sends made on Send, kept on this device from the moment they're sent until
 * they end, to say once the wallet opens again one whose page closed,
 * reloaded, locked or died first: none is ever sent by itself.
 *
 * One that never reached the node never went out: it's said as not sent, to
 * send again through Review or to drop. Before the node is asked to
 * broadcast one, it's kept as handed over, with its transaction's hash,
 * nonce and signed bytes, and only then broadcast: from then on it may have
 * gone out, and only the chain and the node say whether it did
 * ($lib/transactions/handedOverSends). One whose answer got lost stays kept
 * so. It's said as not sent yet while the node doesn't have it and its
 * nonce is still free, to send again as it is, and as not sent once another
 * transaction took its nonce. One the person chose not to send then stays
 * kept, unsaid and never sent again, here or in another tab, until its
 * nonce is taken: it may still arrive.
 *
 * They're kept in IndexedDB, each write on disk before it's done (strict
 * durability): a browser that dies just after finds it there. Storage that
 * keeps a write for later, as localStorage does, would give back the send as
 * it was before it was handed over. What's kept is what Send showed of it,
 * what its form held and the transaction it was signed as, never a password
 * or a key, nor a memo that reads as a recovery phrase, nor a transaction
 * that carries one.
 *
 * A send still being sent in another tab isn't said: that tab holds a lock
 * named after it (Web Locks) while it sends it, and writes it only once it
 * holds it. The lock goes with the tab. Each wallet's are kept under its own
 * name ($lib/wallets/dataNames).
 */

import { Dexie } from "dexie";
import { derived, get, writable } from "svelte/store";

import validateMnemonic from "$lib/wallet/validateMnemonic";
import { walletDataScope } from "$lib/wallets/dataNames";

/**
 * Each wallet's name for them, which this browser's storage kept them under
 * before: what's there is taken over as the wallet opens.
 */
const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-unsent-sends`;

/** What tells the other tabs they changed, as storage tells them it changed. */
const CHANGED = `${CONFIG.LOCAL_STORAGE_APP_KEY}-unsent-sends-changed`;

/** The lock a tab holds while one of its sends is being sent. */
const LOCK = `${CONFIG.LOCAL_STORAGE_APP_KEY}-sending:`;

const db = new Dexie("@dusk-network/kept-sends", {
  autoOpen: true,
  // Done once it's on disk, not before.
  chromeTransactionDurability: "strict",
});

db.version(1).stores({
  // Each send by its ID, with the name of the wallet whose it is.
  sends: "id, wallet",
});

/** The database, for tests. */
export const keptSendsDatabase = db;

/**
 * A send kept until it ends.
 *
 * @typedef {{
 *   account: string,
 *   at: number,
 *   handedOver?: { dismissed?: true, hash: string, nonce: string, tx?: string },
 *   id: string,
 *   label: string,
 *   lux: string,
 *   memo: string,
 *   network: string,
 *   seen?: string,
 *   sentElsewhere?: true,
 *   to: string,
 *   typed: Record<string, unknown>,
 * }} UnsentSend
 *   `account` the public account of the profile it goes from; `handedOver`
 *   the hash and the nonce of the transaction the node was asked to broadcast,
 *   none for one never handed over, and "" for a nonce it has none of, as a
 *   shielded send, with its signed bytes as hex (`tx`), to broadcast it
 *   again as it is, none where they're not kept, and `dismissed` once the
 *   person chose not to send it, its bytes forgotten; `label` whom it goes to,
 *   as Send said it ("your Profile 2"); `lux` its amount; `seen` its
 *   account's nonce as the wallet knew it as it was sent;
 *   `sentElsewhere` that its account sent something else
 *   while it waited, as it was held for the person to say whether to send it
 *   too, or another transaction took its nonce; `to` the address it goes to;
 *   `typed` what Send's form held, to fill it in again.
 */

/** @param {any} handed */
const isHandedOver = (handed) =>
  Boolean(handed) &&
  typeof handed === "object" &&
  typeof handed.hash === "string" &&
  /^[0-9a-f]{64}$/i.test(handed.hash) &&
  typeof handed.nonce === "string" &&
  /^\d*$/.test(handed.nonce) &&
  (handed.dismissed === undefined || handed.dismissed === true) &&
  (handed.tx === undefined ||
    (typeof handed.tx === "string" && /^(?:[0-9a-f]{2})+$/i.test(handed.tx)));

/**
 * @param {any} kept
 * @returns {kept is UnsentSend}
 */
const isUnsent = (kept) =>
  Boolean(kept) &&
  typeof kept === "object" &&
  ["account", "id", "label", "memo", "network", "to"].every(
    (field) => typeof kept[field] === "string"
  ) &&
  typeof kept.at === "number" &&
  typeof kept.lux === "string" &&
  /^\d+$/.test(kept.lux) &&
  (kept.seen === undefined ||
    (typeof kept.seen === "string" && /^\d+$/.test(kept.seen))) &&
  (kept.sentElsewhere === undefined || kept.sentElsewhere === true) &&
  Boolean(kept.typed) &&
  typeof kept.typed === "object" &&
  (kept.handedOver === undefined || isHandedOver(kept.handedOver));

/**
 * A send as it's kept for a wallet: with the wallet's name, and its
 * incarnation, which a wallet made again since doesn't share.
 *
 * @param {UnsentSend} send
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 */
const rowOf = (send, scope) => ({
  ...send,
  owner: scope.owner,
  wallet: scope.name(KEY),
});

/**
 * A send as a row keeps it, without whose it is.
 *
 * @param {Record<string, unknown>} row
 */
function sendOf(row) {
  const send = { ...row };

  delete send.owner;
  delete send.wallet;

  return send;
}

/**
 * A wallet's sends as they're kept, the oldest first: what's kept wrong is
 * left out.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @returns {Promise<UnsentSend[]>}
 */
async function readKept(scope) {
  const rows = await db
    .table("sends")
    .where("wallet")
    .equals(scope.name(KEY))
    .toArray();

  return rows
    .filter((row) => row.owner === scope.owner)
    .map(sendOf)
    .filter(isUnsent)
    .sort((a, b) => a.at - b.at);
}

/**
 * What this browser's storage kept of a wallet's before, where a tab of the
 * wallet as it was before keeps them still: sends that never went out, as
 * none was handed over then. None where it can't be read.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @returns {UnsentSend[]}
 */
function readBefore(scope) {
  try {
    const list = JSON.parse(localStorage.getItem(scope.name(KEY)) ?? "null");

    return Array.isArray(list)
      ? list.filter(isUnsent).filter((send) => send.handedOver === undefined)
      : [];
  } catch {
    return [];
  }
}

/**
 * Takes over one of a wallet's sends this browser's storage kept before,
 * once no tab holds its lock: a tab of the wallet as it was before may be
 * sending it still, and forgets it there before its lock goes where it went
 * out. Read there again then, it's taken over only where it's there still:
 * kept here from now on, and gone from there, the others there left as they
 * are. Never while its lock is held. True once it's taken over.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function takeOverKept(scope, id) {
  const take = async () => {
    const send = readBefore(scope).find((each) => each.id === id);

    if (!send || !scope.keeps()) {
      return false;
    }

    await db.table("sends").put(rowOf(send, scope));

    const rest = readBefore(scope).filter((each) => each.id !== id);

    if (rest.length) {
      localStorage.setItem(scope.name(KEY), JSON.stringify(rest));
    } else {
      localStorage.removeItem(scope.name(KEY));
    }

    return true;
  };

  const { locks } = navigator;

  // Without locks, no tab can say it sends it: taken over as it is.
  return locks?.request ? await locks.request(`${LOCK}${id}`, take) : take();
}

/** Tells the other tabs they changed. */
function tellOtherTabs() {
  try {
    localStorage.setItem(CHANGED, crypto.randomUUID());
  } catch {
    // They see it as they next read them.
  }
}

/** @type {import("svelte/store").Writable<UnsentSend[]>} */
const kept = writable([]);

/**
 * This tab's changes storage hasn't taken yet, by ID, with the name of the
 * wallet they're of: what a read of storage meanwhile shows over what it
 * reads. Null for one forgotten. A change storage refuses stays, as this
 * tab's.
 *
 * @type {Map<string, { send: UnsentSend | null, wallet: string }>}
 */
const unwritten = new Map();

/**
 * Keeps a send for a wallet, as this tab's until storage takes it: rejects
 * where storage refuses it.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @param {UnsentSend} send
 */
function putKept(scope, send) {
  const change = { send, wallet: scope.name(KEY) };

  unwritten.set(send.id, change);

  return db
    .table("sends")
    .put(rowOf(send, scope))
    .then(() => {
      if (unwritten.get(send.id) === change) {
        unwritten.delete(send.id);
      }

      tellOtherTabs();
    });
}

/**
 * Forgets a send, as this tab's until storage takes it: rejects where
 * storage refuses it.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @param {string} id
 */
function deleteKept(scope, id) {
  const change = { send: null, wallet: scope.name(KEY) };

  unwritten.set(id, change);

  return db
    .table("sends")
    .delete(id)
    .then(() => {
      if (unwritten.get(id) === change) {
        unwritten.delete(id);
      }

      tellOtherTabs();
    });
}

/**
 * Changes the open wallet's as shown, where the wallet they're of is still
 * the one shown.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @param {(list: UnsentSend[]) => UnsentSend[]} change
 */
function show(scope, change) {
  if (scope.isShown()) {
    kept.update(change);
  }
}

/**
 * A list with `send` in it, in place of what it kept of it.
 *
 * @param {UnsentSend[]} list
 * @param {UnsentSend} send
 */
const withSend = (list, send) =>
  list.some(({ id }) => id === send.id)
    ? list.map((each) => (each.id === send.id ? send : each))
    : [...list, send];

/**
 * Reads the open wallet's again, as they're kept: shown, where it's still
 * the one shown.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 * @returns {Promise<UnsentSend[] | null>} Them, or null where they can't be
 *   read
 */
async function readAgain(scope) {
  const read = await readKept(scope).catch(() => null);

  if (!read) {
    return null;
  }

  // This tab's changes storage hasn't taken yet, over what it read.
  const changes = [...unwritten].filter(
    ([, { wallet }]) => wallet === scope.name(KEY)
  );
  let list = read.filter(({ id }) => !changes.some(([key]) => key === id));

  for (const [, { send }] of changes) {
    if (send) {
      list = [...list, send];
    }
  }

  if (scope.isShown()) {
    // Those sent the same millisecond in the order they're shown in.
    const shown = get(kept).map(({ id }) => id);
    /** @param {UnsentSend} send */
    const place = (send) =>
      shown.includes(send.id) ? shown.indexOf(send.id) : shown.length;

    kept.set(list.sort((a, b) => a.at - b.at || place(a) - place(b)));
  }

  return list;
}

/**
 * Shows the open wallet's, as it opens: none until they're read. What this
 * browser's storage kept of it before is taken over each once no tab sends
 * it, and shown then.
 *
 * @returns {Promise<void>}
 */
export async function hydrateUnsentSends() {
  const scope = walletDataScope();

  kept.set([]);

  for (const { id } of readBefore(scope)) {
    takeOverKept(scope, id)
      .then(async (isTaken) => {
        if (isTaken) {
          await readAgain(scope);
        }
      })
      .catch(() => {});
  }

  await readAgain(scope);
}

/**
 * Forgets one wallet's, as it's removed, by the ending of its names.
 *
 * @param {string} suffix
 * @returns {Promise<void>}
 */
export async function forgetWalletUnsentSends(suffix) {
  try {
    localStorage.removeItem(`${KEY}${suffix}`);
  } catch {
    // Nothing is kept there where storage can't be read.
  }

  await db.table("sends").where("wallet").equals(`${KEY}${suffix}`).delete();
}

/** The sends this tab is sending: none of them is said while it is. */
const sending = new Set();

/** The sends no tab is sending: those of them still kept are said. */
const over = writable(/** @type {Set<string>} */ (new Set()));

/** The sends whose lock is asked for, to know whether a tab sends them. */
const asking = new Set();

/**
 * When each send asked about was sent: one sent again since, as from its
 * notice, is asked about again.
 *
 * @type {Map<string, number>}
 */
const askedOf = new Map();

/** @param {string} id */
const isOver = (id) => over.update((ids) => new Set(ids).add(id));

/**
 * Finds out whether another tab sends `id`: once its lock is free, as the
 * send ended or its tab went, none does. What's kept of it then is what's
 * said: a tab writes how its send ended before its lock goes.
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

  asking.add(id);
  locks
    .request(`${LOCK}${id}`, () => readAgain(scope))
    .catch(() => {})
    .finally(() => {
      asking.delete(id);
      isOver(id);
    });
}

kept.subscribe((list) => {
  for (const { at, id } of list) {
    // Sent again since, in another tab: asked about again.
    if (askedOf.has(id) && askedOf.get(id) !== at && !sending.has(id)) {
      over.update((ids) => {
        const next = new Set(ids);

        next.delete(id);

        return next;
      });
    }

    askedOf.set(id, at);
    ask(id);
  }
});

if (typeof window !== "undefined") {
  // Another tab changed them: read again.
  window.addEventListener("storage", ({ key }) => {
    const scope = walletDataScope();

    if ((key === CHANGED || key === null) && scope.isShown()) {
      void readAgain(scope);
    }
  });
}

/**
 * The open wallet's sends that no tab is sending, the oldest first: those of
 * the network it's on are for its screens to say. One never handed over
 * never went out; one handed over may have.
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
 * A send as it's sent, kept for the wallet open now:
 * - `handOver` keeps it as handed over to the node, with its transaction's
 *   hash, nonce and signed bytes, done once that's on disk: before the node
 *   is asked to broadcast it. Where storage refuses that, it's kept as never
 *   sent no more; where storage refuses that too, it rejects, and it mustn't
 *   go: what's kept of it would say nothing left the wallet. The bytes of a
 *   transaction whose memo reads as a recovery phrase aren't kept;
 * - `end(true)` leaves it kept, as one that never went out, `end(false)`
 *   forgets it, and `end("handed-over")` leaves it kept as handed over, as
 *   its answer got lost: it may have gone out, for the chain and the node
 *   to say;
 * - `hold()` keeps it as held for the person to say whether to send it too,
 *   as its account sent something else while it waited: it's said so, kept
 *   as never sent, where its page goes, or the wallet locks, before then.
 *
 * While it's being sent, this tab holds its lock, and it's first written
 * only once the tab does: no other tab finds it kept with its lock free
 * while it's being sent. Storage says how it ended before the lock goes.
 *
 * @param {UnsentSend} send
 * @returns {{ end: (keep: boolean | "handed-over") => void, handOver: (sent: import("./sendGate").HandedOver) => Promise<void>, hold: () => void }}
 */
export function keepUnsent(send) {
  const scope = walletDataScope();
  let record = keptOf(send);
  let isEnded = false;

  /**
   * Whether its signed bytes are kept: not where its memo reads as a
   * recovery phrase, which they carry.
   */
  const keepsBytes = record.memo === send.memo;

  /**
   * What's kept of it now: as sent, then as handed over; null once it's
   * not to be kept, as it couldn't be kept as handed over.
   *
   * @type {UnsentSend | null}
   */
  let current = record;

  /** Its writes, one after another, in the order they're made. */
  let writes = Promise.resolve();

  /** @type {(value?: unknown) => void} */
  let release = () => {};

  const released = new Promise((resolve) => {
    release = resolve;
  });

  /**
   * Writes it as it is now, after the writes before: rejects where storage
   * refuses it. Nothing is written once its wallet is gone, nor once it's
   * not to be kept.
   */
  const write = () => {
    const value = current;
    const written = writes.then(() =>
      value && scope.keeps() ? putKept(scope, value) : undefined
    );

    writes = written.catch(() => {});

    return written;
  };

  /** Forgets it, after the writes before: rejects where storage refuses. */
  const forget = () => {
    const forgotten = writes.then(() => deleteKept(scope, record.id));

    writes = forgotten.catch(() => {});

    return forgotten;
  };

  sending.add(record.id);
  show(scope, (list) => withSend(list, record));

  const { locks } = navigator;

  if (locks?.request) {
    locks
      .request(`${LOCK}${record.id}`, async () => {
        if (!isEnded) {
          await write().catch(() => {});
        }

        return released;
      })
      .catch(() => {
        // Not held: kept all the same, as it would be without locks.
        if (!isEnded) {
          write().catch(() => {});
        }
      });
  } else {
    write().catch(() => {});
  }

  return {
    end(keep) {
      if (isEnded) {
        return;
      }

      isEnded = true;
      sending.delete(record.id);

      if (keep === "handed-over" && current?.handedOver) {
        // Its answer got lost: kept as handed over, as it's on disk, and
        // no tab sends it, as this one knows.
        const handedOver = current;

        isOver(record.id);
        show(scope, (list) => withSend(list, handedOver));
        writes.finally(release);
      } else if (keep === true) {
        // It never went out: no tab sends it, as this one knows.
        current = record;
        isOver(record.id);
        show(scope, (list) => withSend(list, record));
        write()
          .catch(() => {})
          .finally(release);
      } else {
        show(scope, (list) => list.filter(({ id }) => id !== record.id));
        forget()
          .catch(() => {})
          .finally(release);
      }
    },
    hold() {
      if (isEnded || record.sentElsewhere) {
        return;
      }

      record = { ...record, sentElsewhere: true };

      // Unless it's kept as handed over by now.
      if (current && !current.handedOver) {
        current = record;
        show(scope, (list) => withSend(list, record));
        write().catch(() => {});
      }
    },
    async handOver({ hash, nonce, tx = "" }) {
      const handedOver = {
        ...record,
        handedOver: { hash, nonce, ...(tx && keepsBytes ? { tx } : {}) },
      };

      current = handedOver;
      show(scope, (list) => withSend(list, handedOver));

      try {
        await write();
      } catch {
        // Not kept as handed over: then not kept as never sent either, nor
        // written again.
        current = null;
        show(scope, (list) => list.filter(({ id }) => id !== record.id));
        await forget();
      }
    },
  };
}

/**
 * Forgets the open wallet's sends that are the same as one made now: the
 * same amount, from the same profile, to the same address, with the same
 * memo. Made again, it's no longer one to say, whether or not it went out.
 *
 * @param {Pick<UnsentSend, "account" | "lux" | "memo" | "network" | "to">} send
 */
export function forgetSameUnsent({ account, lux, memo, network, to }) {
  for (const same of get(unsentSends).filter(
    (kept) =>
      // One the person chose not to send is followed until its nonce is
      // taken, as it may still arrive.
      !kept.handedOver?.dismissed &&
      kept.account === account &&
      kept.lux === lux &&
      kept.memo === memo &&
      kept.network === network &&
      kept.to === to
  )) {
    dropUnsent(same.id);
  }
}

/**
 * Drops a send that never went out, as the person chooses not to send it, or
 * one handed over, as the chain says what became of it, or the person is
 * done with it.
 *
 * @param {string} id
 */
export function dropUnsent(id) {
  const scope = walletDataScope();

  show(scope, (list) => list.filter((kept) => kept.id !== id));
  deleteKept(scope, id).catch(() => {});
}

/**
 * Changes what's kept of a send handed over as the transaction `hash`, only
 * while it's kept so, and no tab sends it: another tab may have sent it
 * again since, under its ID, as another transaction ("Send it now"), which
 * nothing found of this one may change. Storage is read and written in one
 * transaction, as that tab writes there; it's shown so once storage took
 * it. `change` gives what's kept of it from then on, or null to forget it.
 * Resolves true where it was kept so, and changed; rejects where storage
 * refuses, leaving it as it was.
 *
 * @param {string} id
 * @param {string} hash
 * @param {(send: UnsentSend) => UnsentSend | null} change
 * @returns {Promise<boolean>}
 */
async function changeHandedOver(id, hash, change) {
  const scope = walletDataScope();
  const sends = db.table("sends");
  /** @param {UnsentSend | null | undefined} send */
  const isKeptAs = (send) =>
    send?.id === id &&
    send.handedOver?.hash.toLowerCase() === hash.toLowerCase();

  if (!get(unsentSends).some(isKeptAs)) {
    return false;
  }

  const changed = await db.transaction("rw", sends, async () => {
    const row = await sends.get(id);
    const send =
      row?.wallet === scope.name(KEY) && row.owner === scope.owner
        ? sendOf(row)
        : null;

    if (!isUnsent(send) || !isKeptAs(send)) {
      return null;
    }

    const next = change(send);

    if (next) {
      await sends.put(rowOf(next, scope));
    } else {
      await sends.delete(id);
    }

    return { next };
  });

  if (!changed) {
    return false;
  }

  const { next } = changed;

  show(scope, (list) =>
    next ? withSend(list, next) : list.filter((kept) => kept.id !== id)
  );
  tellOtherTabs();

  return true;
}

/**
 * Keeps a send that was handed over as the transaction `hash` as one that
 * never went out, once its account's transaction with its nonce is in a
 * final block under another hash: this one can never be in one. It's said
 * as not sent from then on, its account having sent something else while it
 * waited, to send too through Review or to drop. Only while it's kept as
 * that transaction: see `changeHandedOver`.
 *
 * @param {string} id
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export const keepNotSent = (id, hash) =>
  changeHandedOver(id, hash, (send) => {
    /** @type {UnsentSend} */
    const notSent = { ...send, sentElsewhere: true };

    delete notSent.handedOver;

    return notSent;
  });

/**
 * Keeps a send that was handed over as the transaction `hash` as one the
 * person chose not to send: never sent again, its bytes forgotten, and not
 * said, but kept until its nonce is taken, as it may still arrive. Only
 * while it's kept as that transaction: see `changeHandedOver`.
 *
 * @param {string} id
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export const dismissHandedOver = (id, hash) =>
  changeHandedOver(id, hash, (send) => ({
    ...send,
    handedOver: {
      dismissed: true,
      hash: /** @type {{ hash: string }} */ (send.handedOver).hash,
      nonce: /** @type {{ nonce: string }} */ (send.handedOver).nonce,
    },
  }));

/**
 * Runs `act` on what's kept of a send handed over as the transaction
 * `hash`, as storage has it then, while no tab sends it, nor acts on it so:
 * under its lock (Web Locks), so that one tab's Send it now and another's
 * Don't send never cross, and one the person chose not to send is never
 * sent again. `act` is given null where it's no longer kept as that
 * transaction.
 *
 * @template T
 * @param {string} id
 * @param {string} hash
 * @param {(send: UnsentSend | null) => Promise<T>} act
 * @returns {Promise<T>}
 */
export function actOnHandedOver(id, hash, act) {
  const scope = walletDataScope();
  const run = async () => {
    const row = await db.table("sends").get(id);
    const send =
      row?.wallet === scope.name(KEY) && row.owner === scope.owner
        ? sendOf(row)
        : null;

    return act(
      isUnsent(send) &&
        send.handedOver?.hash.toLowerCase() === hash.toLowerCase()
        ? send
        : null
    );
  };
  const { locks } = navigator;

  return locks?.request
    ? /** @type {Promise<T>} */ (locks.request(`${LOCK}${id}`, run))
    : run();
}

/**
 * Forgets a send that was handed over as the transaction `hash`, once the
 * chain has that transaction. Only while it's kept as that transaction: see
 * `changeHandedOver`.
 *
 * @param {string} id
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export const dropHandedOver = (id, hash) =>
  changeHandedOver(id, hash, () => null);

/** @type {import("svelte/store").Writable<UnsentSend | null>} */
const refills = writable(null);

/** A send that never went out, for Send to fill its form in with: null for none. */
export const unsentRefill = { subscribe: refills.subscribe };

/**
 * Asks Send to fill its form in with a send that never went out, and to take
 * it to its review: said until it's handed over, or dropped.
 *
 * @param {UnsentSend} send
 */
export function sendUnsentAgain(send) {
  refills.set(send);
}

/**
 * The send Send was asked to fill its form in with, once: null for none, or
 * for one of another profile's or network's than the one Send sends from.
 * It's kept until Send sends it, which takes its place, or it's dropped.
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

  return send.account === account && send.network === network ? send : null;
}
