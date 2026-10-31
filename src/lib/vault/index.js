/**
 * The vault: every recovery phrase on this device, under one password.
 *
 * - `${APP_KEY}-login` (v1) holds the one phrase earlier versions kept, as
 *   they sealed it: `{ data, iv, salt, version? }` in base64, AES-GCM-256
 *   under a PBKDF2-SHA-256 key from the password and the salt, with 600,000
 *   iterations (`version: 1`) or 10,000 (no version: a legacy record).
 * - `${APP_KEY}-login-v2` (v2) holds every phrase:
 *   `{ version: 2, wallets: [{ id, n, data, iv, salt, version }] }`. Each
 *   wallet's phrase is sealed as v1 seals its one, with an IV of its own and
 *   its own iterations, by its `version`. A wallet added reuses the salt of
 *   one here that the password opens, so an unlock derives the key once for
 *   all of them; a new password gives them all one new salt. No wallet is
 *   ever added to a legacy salt. `id` names the wallet; `n` is its number,
 *   "Wallet 2", which stays when another wallet goes.
 *
 * The move from v1 runs on unlock, with the password that opens it: v2 is
 * written with v1's record in it (a legacy record sealed again at the
 * current version first, as earlier versions did on unlock), read back and
 * opened with the password, and only then does v1 go. Cut short at any
 * step, v1 or v2 still holds the phrase, and the next unlock finishes the
 * move. A wrong password moves nothing, and a v2 this version can't read
 * never hides v1, which opens beside it.
 *
 * Every change of the two runs alone across this browser's tabs, under the
 * login lock. Nothing the password doesn't open is changed or removed, but
 * by a reset (`clear`) or a new setup in place of every wallet (`setUp`).
 */

import { base64ToBytes, bytesToBase64 } from "$lib/dusk/base64";
import InvalidPasswordError from "$lib/errors/invalid-password-error";
import getDerivedKey from "$lib/wallet/getDerivedKey";
import {
  CURRENT_WALLET_ENCRYPTION_VERSION,
  getWalletEncryptionIterations,
} from "$lib/wallet/walletEncryption";

const V1_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
const V2_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login-v2`;
const VAULT_VERSION = 2;

const NO_VAULT = "There's no wallet here. Restore it with its recovery phrase.";
const NOT_SAVED = "The wallet couldn't be saved. Try again.";
const UNSUPPORTED =
  "This wallet's saved data can't be read. Restore it with its recovery phrase.";

/** The one sentence a phrase that's here already gets. */
export const DUPLICATE_PHRASE =
  "This recovery phrase is already in your wallet.";

/** The one sentence removing the only wallet gets. */
export const ONLY_WALLET = "This is the only wallet here. Reset removes it.";

/** The one sentence removing a wallet that isn't here gets. */
export const NOT_HERE = "That wallet isn't here.";

/**
 * @typedef {{ data: string, iv: string, salt: string, version?: number }} Sealed
 * @typedef {Sealed & { id: string, n: number }} VaultWallet
 * @typedef {{ version: 2, wallets: VaultWallet[] }} VaultV2
 * @typedef {{ id: string, n: number, mnemonic: string }} OpenedWallet
 * @typedef {(salt: string, iterations: number) => Promise<CryptoKey>} Keyring
 * @typedef {{ id: string, keys: Keyring, mnemonic: string }} Change
 */

const decode = /** @type {(value: string) => Uint8Array<ArrayBuffer>} */ (
  base64ToBytes
);

/** @param {Uint8Array} bytes */
const hex = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** @param {string} text */
const utf8 = (text) => new TextEncoder().encode(text);

/**
 * Every change of the vault, one at a time across this browser's tabs: the
 * lock every login write took before the vault held more than one phrase.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @param {AbortSignal} [signal] Aborts waiting for the lock, and the task
 *   before it begins
 * @returns {Promise<T>}
 */
const alone = (task, signal) =>
  /** @type {Promise<T>} */ (
    navigator.locks.request(V1_KEY, signal ? { signal } : {}, async () => {
      signal?.throwIfAborted();

      return task();
    })
  );

/**
 * A stored record, parsed: null when there's none, and `{}` when it isn't
 * JSON, which no reader takes for a vault.
 *
 * @param {string | null} text
 * @returns {any}
 */
function parse(text) {
  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** @returns {any} */
const readV2 = () => parse(localStorage.getItem(V2_KEY));

/**
 * The key's iterations by the record's version; 0 for a version this one
 * doesn't know.
 *
 * @param {{ version?: unknown }} record
 */
function iterationsOf(record) {
  try {
    return getWalletEncryptionIterations(
      /** @type {number | undefined} */ (record.version)
    );
  } catch {
    return 0;
  }
}

/**
 * A phrase sealed as v1 seals it: what v1 is, and each wallet in v2 holds.
 *
 * @param {any} value
 * @returns {value is Sealed}
 */
const isSealed = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof value.data === "string" &&
  typeof value.iv === "string" &&
  typeof value.salt === "string" &&
  iterationsOf(value) > 0;

/** @param {Sealed} sealed */
const isCurrent = (sealed) =>
  sealed.version === CURRENT_WALLET_ENCRYPTION_VERSION;

/**
 * @param {any} value
 * @returns {value is VaultV2}
 */
const isVaultV2 = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  value.version === VAULT_VERSION &&
  Array.isArray(value.wallets);

/**
 * @param {any} wallet
 * @returns {wallet is VaultWallet}
 */
const isWallet = (wallet) =>
  isSealed(wallet) &&
  typeof (/** @type {any} */ (wallet).id) === "string" &&
  /** @type {any} */ (wallet).id.length > 0 &&
  Number.isInteger(/** @type {any} */ (wallet).n) &&
  /** @type {any} */ (wallet).n > 0;

/**
 * A sealed phrase's own fields, as v1 keeps them.
 *
 * @param {Sealed} sealed
 * @returns {Sealed}
 */
const sealedOf = ({ data, iv, salt, version }) => ({
  data,
  iv,
  salt,
  ...(version === undefined ? {} : { version }),
});

/**
 * The same record, whatever order its fields come in.
 *
 * @param {any} value
 * @returns {any}
 */
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;

/**
 * @param {any} a
 * @param {any} b
 */
const sameRecord = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Two spellings of one recovery phrase are the same phrase.
 *
 * @param {string | null} a
 * @param {string | null} b
 */
function samePhrase(a, b) {
  /** @param {string | null} m */
  const norm = (m) =>
    String(m ?? "")
      .normalize("NFKD")
      .trim()
      .split(/\s+/)
      .join(" ");

  return norm(a) === norm(b);
}

/**
 * The number the next wallet gets: one past the highest here.
 *
 * @param {Array<{ n?: number }>} wallets
 */
export const nextWalletNumber = (wallets) =>
  Math.max(0, ...wallets.map((wallet) => Number(wallet?.n) || 0)) + 1;

/**
 * @param {{ n: number }} a
 * @param {{ n: number }} b
 */
const byNumber = (a, b) => a.n - b.n;

const newWalletId = () => hex(crypto.getRandomValues(new Uint8Array(16)));

/**
 * The keys one password makes during one unlock or change of the vault: one
 * PBKDF2 per salt and iteration count, however many phrases share them.
 *
 * @param {string} password
 * @returns {Keyring}
 */
function keyring(password) {
  /** @type {Map<string, Promise<CryptoKey>>} */
  const keys = new Map();

  return (salt, iterations) => {
    const id = `${salt}:${iterations}`;
    let key = keys.get(id);

    if (!key) {
      key = Promise.resolve().then(() =>
        getDerivedKey(password, decode(salt), iterations, false)
      );

      // A salt that isn't one fails each phrase that has it, on its own.
      key.catch(() => {});
      keys.set(id, key);
    }

    return key;
  };
}

/**
 * A salt of its own, at the current version: for a new vault's phrase, or a
 * new password's.
 *
 * @returns {{ salt: string, version: number }}
 */
const freshSalt = () => ({
  salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
  version: CURRENT_WALLET_ENCRYPTION_VERSION,
});

/**
 * `mnemonic` sealed with the keyring's password, under the salt and version
 * of `like` (a phrase here, or freshSalt()) and an IV of its own. Never
 * under a legacy salt.
 *
 * @param {string} mnemonic
 * @param {Keyring} keys
 * @param {{ salt: string, version?: number }} like
 * @returns {Promise<Sealed>}
 */
async function seal(mnemonic, keys, like) {
  if (like.version !== CURRENT_WALLET_ENCRYPTION_VERSION) {
    throw new Error("A phrase is sealed at the current version only");
  }

  const key = await keys(like.salt, iterationsOf(like));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, utf8(mnemonic))
  );

  return {
    data: bytesToBase64(data),
    iv: bytesToBase64(iv),
    salt: like.salt,
    version: like.version,
  };
}

/**
 * The phrase `sealed` holds, or null when the keyring's password doesn't
 * open it.
 *
 * @param {Sealed} sealed
 * @param {Keyring} keys
 * @returns {Promise<string | null>}
 */
async function openSealed(sealed, keys) {
  try {
    const key = await keys(sealed.salt, iterationsOf(sealed));
    const plain = await crypto.subtle.decrypt(
      { iv: decode(sealed.iv), name: "AES-GCM" },
      key,
      decode(sealed.data)
    );

    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/**
 * The wallet v1's phrase becomes: named by v1's random salt, so that a move
 * tried again names it the same.
 *
 * @param {Sealed} v1
 */
async function v1WalletId(v1) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(String(v1.salt)));

  return `v1-${hex(new Uint8Array(digest)).slice(0, 32)}`;
}

/**
 * Writes `next` as v2, reads it back and checks it: the wallets in `changed`
 * open with their keyring to their phrase, every other wallet is as it was
 * written, and those in `gone` are gone. Otherwise, a read back that failed
 * included, v2 is put back as it was before the write, and it throws.
 *
 * @param {VaultV2} next
 * @param {{ changed?: Change[], gone?: string[] }} check
 */
async function writeV2(next, { changed = [], gone = [] }) {
  const before = localStorage.getItem(V2_KEY);

  localStorage.setItem(V2_KEY, JSON.stringify(next));

  const ok = await (async () => {
    const back = readV2();

    if (!isVaultV2(back) || back.wallets.length !== next.wallets.length) {
      return false;
    }

    if (gone.some((id) => back.wallets.some((w) => w.id === id))) {
      return false;
    }

    for (const want of next.wallets) {
      const got = back.wallets.find((w) => w.id === want.id);

      if (!got || !sameRecord(got, want)) {
        return false;
      }
    }

    for (const { id, keys, mnemonic } of changed) {
      const got = back.wallets.find((w) => w.id === id);

      if (!got || (await openSealed(got, keys)) !== mnemonic) {
        return false;
      }
    }

    return true;
  })().catch(() => false);

  if (ok) {
    return;
  }

  try {
    if (before === null) {
      localStorage.removeItem(V2_KEY);
    } else {
      localStorage.setItem(V2_KEY, before);
    }
  } catch {
    // The next unlock reads what's there.
  }

  throw new Error(NOT_SAVED);
}

/**
 * The wallets in `wallets` that the keyring opens, with their phrases.
 *
 * @param {VaultWallet[]} wallets
 * @param {Keyring} keys
 * @returns {Promise<OpenedWallet[]>}
 */
async function openWallets(wallets, keys) {
  /** @type {OpenedWallet[]} */
  const opened = [];

  for (const wallet of wallets) {
    const mnemonic = await openSealed(wallet, keys);

    if (mnemonic !== null) {
      opened.push({ id: wallet.id, mnemonic, n: wallet.n });
    }
  }

  return opened;
}

/**
 * v1's phrase into v2, then v1 gone: v1's record copied over as it is (a
 * legacy one sealed again at the current version first), unless v2 opens to
 * the phrase already (a move cut short after its write, or the same phrase),
 * then v2 read back and opened with the password, and only then v1 removed.
 * Returns the wallet that holds the phrase.
 *
 * @param {Sealed} v1
 * @param {string} mnemonic
 * @param {Keyring} keys
 * @param {OpenedWallet[]} opened
 * @returns {Promise<{ id: string, n: number }>}
 */
async function moveV1(v1, mnemonic, keys, opened) {
  const v2 = readV2();

  if (v2 !== null && !isVaultV2(v2)) {
    throw new Error(UNSUPPORTED);
  }

  const same = opened.find((w) => samePhrase(w.mnemonic, mnemonic));

  if (same) {
    await dropMovedV1(same.id, mnemonic, keys);

    return { id: same.id, n: same.n };
  }

  const id = await v1WalletId(v1);

  /** @type {VaultWallet[]} */
  const wallets = v2?.wallets ?? [];

  // A copy of v1 that doesn't open is no copy: v1's record takes its place.
  const broken = wallets.find((w) => w.id === id);
  const holder = {
    id,
    n: broken?.n ?? nextWalletNumber([...wallets, ...opened]),
    ...(isCurrent(v1) ? sealedOf(v1) : await seal(mnemonic, keys, freshSalt())),
  };

  await writeV2(
    {
      version: VAULT_VERSION,
      wallets: broken
        ? wallets.map((w) => (w.id === id ? holder : w))
        : [...wallets, holder],
    },
    { changed: [{ id, keys, mnemonic }] }
  );
  localStorage.removeItem(V1_KEY);

  return { id, n: holder.n };
}

/**
 * v1 removed, once v2's wallet `id`, read again, opens to its phrase: a
 * move cut short after its write, or the same phrase already in v2.
 *
 * @param {string} id
 * @param {string} mnemonic
 * @param {Keyring} keys
 */
async function dropMovedV1(id, mnemonic, keys) {
  const back = readV2()?.wallets?.find(
    (/** @type {VaultWallet} */ w) => w.id === id
  );

  if (!back || !samePhrase(await openSealed(back, keys), mnemonic)) {
    throw new Error("The wallet couldn't be moved");
  }

  localStorage.removeItem(V1_KEY);
}

/**
 * v1's phrase, opened, moved into v2 when it can be: the wallet that holds
 * it now, which `opened` gets when it's new, and whether v1 stays.
 *
 * @param {Sealed} v1
 * @param {string} mnemonic
 * @param {Keyring} keys
 * @param {{ opened: OpenedWallet[], wallets: VaultWallet[] }} vault
 * @returns {Promise<{ id: string, v1Left: boolean }>}
 */
async function takeInV1(v1, mnemonic, keys, { opened, wallets }) {
  let moved;
  let v1Left = false;

  try {
    moved = await moveV1(v1, mnemonic, keys, opened);
  } catch {
    // v1 stays, and opens this time as it did before: the next unlock
    // moves it.
    v1Left = true;
    moved = {
      id: await v1WalletId(v1),
      n: nextWalletNumber([...wallets, ...opened]),
    };
  }

  const holder = opened.find(
    (w) => w.id === moved.id || samePhrase(w.mnemonic, mnemonic)
  );

  if (!holder) {
    opened.push({ ...moved, mnemonic });
  }

  return { id: holder?.id ?? moved.id, v1Left };
}

/**
 * Every wallet the password opens, with v1's moved in when it opens: the
 * unlock's work, and what each change of the vault checks the password
 * with. `opened` is empty for a password that opens nothing; `fromV1` is
 * the wallet whose phrase v1 held, when v1 opened; `v1Left` says v1
 * opened but couldn't be moved this time, and stays. `keys` are the
 * password's, for a change to seal with.
 *
 * @param {string} password
 */
async function openVault(password) {
  const v1 = parse(localStorage.getItem(V1_KEY));
  const v2 = readV2();

  if (v1 === null && v2 === null) {
    throw new Error(NO_VAULT);
  }

  // A vault this version can't read stays as it is; v1's phrase beside it
  // still opens, and stays too.
  if (!isVaultV2(v2) && !isSealed(v1)) {
    throw new Error(UNSUPPORTED);
  }

  const keys = keyring(password);
  const wallets = (isVaultV2(v2) ? v2.wallets : []).filter(isWallet);
  const opened = await openWallets(wallets, keys);
  const fromV1 = isSealed(v1) ? await openSealed(v1, keys) : null;
  const taken =
    fromV1 === null
      ? { id: null, v1Left: false }
      : await takeInV1(v1, fromV1, keys, { opened, wallets });

  opened.sort(byNumber);

  return {
    fromV1: taken.id,
    keys,
    opened,
    record: readV2(),
    v1Left: taken.v1Left,
  };
}

/**
 * The vault opened with the password for a change: refused for a wrong
 * password, one that doesn't open every wallet in `held` (those this tab
 * unlocked with one password) included, and while v1 is still to move (a
 * write just failed; the next try moves it).
 *
 * @param {string} password
 * @param {string[]} [held]
 */
async function openForChange(password, held = []) {
  const { keys, opened, record, v1Left } = await openVault(password);

  if (!opened.length || !held.every((id) => opened.some((w) => w.id === id))) {
    throw new InvalidPasswordError();
  }

  if (record !== null && !isVaultV2(record)) {
    throw new Error(UNSUPPORTED);
  }

  if (v1Left || !isVaultV2(record)) {
    throw new Error(NOT_SAVED);
  }

  return { keys, opened, record };
}

const vault = {
  /**
   * Another wallet in the vault, sealed under the password that opens it:
   * one whose phrase is here already is refused (DUPLICATE_PHRASE). The
   * password must open every wallet in `held`.
   *
   * @param {string} mnemonic
   * @param {string} password
   * @param {{ held?: string[] }} [options]
   * @returns {Promise<{ id: string, n: number }>}
   */
  add(mnemonic, password, { held = [] } = {}) {
    return alone(async () => {
      const m = String(mnemonic ?? "").trim();
      const { keys, opened, record } = await openForChange(
        String(password ?? ""),
        held
      );

      if (opened.some((w) => samePhrase(w.mnemonic, m))) {
        throw new Error(DUPLICATE_PHRASE);
      }

      const wallet = {
        id: newWalletId(),
        n: nextWalletNumber([...record.wallets, ...opened]),
      };

      // Sealed with the salt of a wallet here that the password opens: its
      // key, derived as the vault opened, seals it, and opens them all next
      // time. Never a legacy one's.
      const like =
        record.wallets.find(
          (w) => isCurrent(w) && opened.some((o) => o.id === w.id)
        ) ?? freshSalt();

      await writeV2(
        {
          version: VAULT_VERSION,
          wallets: [
            ...record.wallets,
            { ...wallet, ...(await seal(m, keys, like)) },
          ],
        },
        { changed: [{ id: wallet.id, keys, mnemonic: m }] }
      );

      return wallet;
    });
  },

  /**
   * A new password: every phrase the old one opens sealed again under one
   * new salt. A phrase it doesn't open stays as it is. The password must
   * open every wallet in `held`.
   *
   * @param {string} password
   * @param {string} newPassword
   * @param {{ held?: string[] }} [options]
   * @returns {Promise<void>}
   */
  changePassword(password, newPassword, { held = [] } = {}) {
    return alone(async () => {
      const next = String(newPassword ?? "");

      if (!next) {
        throw new Error("Enter a new password.");
      }

      const { opened, record } = await openForChange(
        String(password ?? ""),
        held
      );
      const phrases = new Map(opened.map((w) => [w.id, w.mnemonic]));

      // One new salt for all of them: the new password's key, derived once.
      const keys = keyring(next);
      const like = freshSalt();
      const wallets = [];

      for (const w of record.wallets) {
        const mnemonic = phrases.get(w.id);

        wallets.push(
          mnemonic === undefined
            ? w
            : { id: w.id, n: w.n, ...(await seal(mnemonic, keys, like)) }
        );
      }

      await writeV2(
        { version: VAULT_VERSION, wallets },
        {
          changed: [...phrases].map(([id, mnemonic]) => ({
            id,
            keys,
            mnemonic,
          })),
        }
      );
    });
  },

  /**
   * Removes every wallet's phrase, v1's too, as a reset does.
   *
   * @returns {Promise<void>}
   */
  clear() {
    return alone(async () => {
      localStorage.removeItem(V2_KEY);
      localStorage.removeItem(V1_KEY);
    });
  },

  /** Whether there's a vault here: a phrase under a password. */
  exists() {
    return (
      localStorage.getItem(V2_KEY) !== null ||
      localStorage.getItem(V1_KEY) !== null
    );
  },

  /**
   * The wallets v2 holds, by ID and number, as anyone can read them: no
   * phrase, no password needed. Null while there's no v2 this version
   * reads.
   *
   * @returns {Array<{ id: string, n: number }> | null}
   */
  list() {
    const v2 = readV2();

    return isVaultV2(v2)
      ? v2.wallets.filter(isWallet).map(({ id, n }) => ({ id, n }))
      : null;
  },

  /**
   * Removes one wallet: the password must open it, and the others stay as
   * they are. The only wallet here isn't removed (Reset removes it).
   *
   * @param {string} id
   * @param {string} password
   * @returns {Promise<void>}
   */
  remove(id, password) {
    return alone(async () => {
      const key = String(id ?? "");
      const { opened, record } = await openForChange(String(password ?? ""));

      // The password must open the wallet it removes.
      if (!opened.some((w) => w.id === key)) {
        if (record.wallets.some((w) => w.id === key)) {
          throw new InvalidPasswordError();
        }

        throw new Error(NOT_HERE);
      }

      if (record.wallets.filter(isWallet).length < 2) {
        throw new Error(ONLY_WALLET);
      }

      await writeV2(
        {
          version: VAULT_VERSION,
          wallets: record.wallets.filter((w) => w.id !== key),
        },
        { gone: [key] }
      );
    });
  },

  /**
   * A vault with one wallet, `mnemonic` under `password`, in place of every
   * phrase here: a wallet created or restored in place of the ones here.
   * The vault before stays when the new one can't be saved.
   *
   * @param {string} mnemonic
   * @param {string} password
   * @returns {Promise<{ id: string, n: number }>}
   */
  setUp(mnemonic, password) {
    return alone(async () => {
      const m = String(mnemonic ?? "").trim();
      const p = String(password ?? "");

      if (!m || !p) {
        throw new Error("A recovery phrase and a password are needed.");
      }

      const keys = keyring(p);
      const wallet = { id: newWalletId(), n: 1 };

      await writeV2(
        {
          version: VAULT_VERSION,
          wallets: [{ ...wallet, ...(await seal(m, keys, freshSalt())) }],
        },
        { changed: [{ id: wallet.id, keys, mnemonic: m }] }
      );
      localStorage.removeItem(V1_KEY);

      return wallet;
    });
  },

  /**
   * Every wallet the password opens, moving v1's into v2 first: their IDs,
   * numbers and phrases, by number, and the wallet whose phrase v1 held,
   * when v1 opened (`fromV1`). A wrong password throws
   * InvalidPasswordError, and changes nothing.
   *
   * @param {string} password
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ fromV1: string | null, wallets: OpenedWallet[] }>}
   */
  unlock(password, { signal } = {}) {
    return alone(async () => {
      const { fromV1, opened } = await openVault(String(password ?? ""));

      if (!opened.length) {
        throw new InvalidPasswordError();
      }

      return { fromV1, wallets: opened };
    }, signal);
  },
};

export default vault;
