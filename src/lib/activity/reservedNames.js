/**
 * Which `.dusk` name each reservation in the history was for: the name of
 * the registration that reveals it, sent after it from the same account and
 * checked against that account. A reservation that none reveals has no
 * name. Worked out from the history as it changes: nothing is asked of the
 * network.
 */

import { get, writable } from "svelte/store";

import { walletStore } from "$lib/stores";

/** @typedef {typeof import("@duskdomains/sdk")} DuskDomainsSdk */

const store = writable(/** @type {Map<string, string>} */ (new Map()));

/**
 * What each registration revealed, by the account and its transaction:
 * its name where it checks out for the account, else null.
 *
 * @type {Map<string, string | null>}
 */
const checked = new Map();

/** Counts the loads: only the last one's names show. */
let loads = 0;

/**
 * Whether `row` comes after `earlier` in an account's history: in a later
 * block, or not in one yet, or sent later while neither is in a block.
 *
 * @param {ActivityRow} row
 * @param {ActivityRow} earlier
 */
function isAfter(row, earlier) {
  if (row.blockHeight !== undefined && earlier.blockHeight !== undefined) {
    return row.blockHeight > earlier.blockHeight;
  }

  if (earlier.blockHeight !== undefined) {
    return true;
  }

  return (
    row.blockHeight === undefined &&
    (row.submittedAt ?? 0) > (earlier.submittedAt ?? 0)
  );
}

/**
 * The name a registration registered, where what it reveals of its
 * reservation checks out for the account that sent it; null otherwise.
 *
 * @param {ActivityRow} row
 * @param {string} account The public account the history is of
 * @param {DuskDomainsSdk} sdk
 * @returns {string | null}
 */
export function revealedName(row, account, sdk) {
  const commit = row.nameCommit;
  const name = row.registeredName;

  if (!commit?.secret || !commit.node || !name?.endsWith(".dusk")) {
    return null;
  }

  try {
    const label = name.slice(0, -".dusk".length);
    const actor = sdk.contractPrincipalFromWalletAccount(account);

    if (!actor.ok || sdk.namehashHex(name) !== commit.node) {
      return null;
    }

    const made = sdk.commitmentHash(
      sdk.fromHex(actor.principal, 32),
      label,
      sdk.fromHex(commit.secret, 32)
    );

    return sdk.hex(made) === commit.commitment ? name : null;
  } catch {
    return null;
  }
}

/**
 * Each reservation's name, by its transaction: that of the first
 * registration after it that reveals its commitment, as `reveals` says.
 *
 * @param {ActivityRow[]} rows
 * @param {(registration: ActivityRow) => string | null} reveals
 * @returns {Map<string, string>}
 */
export function reservationNames(rows, reveals) {
  const registrations = rows
    .filter((row) => row.nameCommit?.secret)
    .sort((a, b) => (isAfter(a, b) ? 1 : isAfter(b, a) ? -1 : 0));

  /** @type {Map<string, string>} */
  const names = new Map();

  for (const row of rows) {
    const commit = row.nameCommit;

    if (!commit?.commitment || commit.secret) {
      continue;
    }

    for (const registration of registrations) {
      const name =
        registration.nameCommit?.commitment === commit.commitment &&
        isAfter(registration, row)
          ? reveals(registration)
          : null;

      if (name) {
        names.set(row.hash, name);
        break;
      }
    }
  }

  return names;
}

/** The public account the wallet shows the history of, or "". */
const accountNow = () => String(get(walletStore).currentProfile?.account ?? "");

/**
 * @param {Map<string, string>} a
 * @param {Map<string, string>} b
 */
const sameNames = (a, b) =>
  a.size === b.size && [...a].every(([hash, name]) => b.get(hash) === name);

/**
 * Works the reservations' names out for the rows, of the account the wallet
 * shows: each registration is checked once.
 *
 * @param {ActivityRow[]} rows
 */
async function load(rows) {
  const thisLoad = ++loads;
  const account = accountNow();
  const calls = rows.filter((row) => row.nameCommit);
  const key = (/** @type {ActivityRow} */ row) => `${account} ${row.hash}`;
  const unchecked = calls.filter(
    (row) => row.nameCommit?.secret && !checked.has(key(row))
  );

  if (account && unchecked.length) {
    try {
      const sdk = await import("@duskdomains/sdk");

      for (const row of unchecked) {
        checked.set(key(row), revealedName(row, account, sdk));
      }
    } catch {
      // Checked again with the next load.
    }
  }

  if (thisLoad !== loads) {
    return;
  }

  const next = account
    ? reservationNames(calls, (row) => checked.get(key(row)) ?? null)
    : new Map();

  if (!sameNames(next, get(store))) {
    store.set(next);
  }
}

export default { load, subscribe: store.subscribe };
