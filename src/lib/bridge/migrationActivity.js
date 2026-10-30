/**
 * Migrations into Dusk and transfers out to another chain, for Bridge ›
 * Activity, as the bridge site follows them:
 * - a migration from BNB Smart Chain or Ethereum is sent there, then paid
 *   on Dusk: its route's payout account pays this account the amount, with
 *   the migration's transaction hash as the memo. The history has the
 *   payout; this browser keeps the migrations it sent until it does.
 * - a transfer to another chain is a public transfer to the route's
 *   account, with the address it pays as the memo: sent until the chain's
 *   DUSK token pays that address the amount less the bridge's fee.
 */

import { get, writable } from "svelte/store";

/** How many migrations this browser keeps. */
const MAX_KEPT = 50;

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`;

const EVM_HASH = /^0x[0-9a-f]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WEI_PER_LUX = 1_000_000_000n;

/**
 * A migration this browser sent.
 *
 * @typedef {{
 *   amountLux: string,
 *   confirmed?: boolean,
 *   createdAt: number,
 *   failed?: boolean,
 *   hash: string,
 *   recipient: string,
 *   routeId: string,
 *   sender: string,
 * }} KeptMigration
 *   `hash` the migration's transaction on its chain; `confirmed` once its
 *   receipt says it went through, `failed` once it says it reverted.
 */

/**
 * A transfer between Dusk and another chain, as Bridge › Activity lists it.
 *
 * @typedef {{
 *   amountLux: bigint,
 *   arrivedAt?: number | null,
 *   at: number | null,
 *   failure?: string,
 *   feeLux?: bigint,
 *   hash: string,
 *   kind: "migration" | "service",
 *   paidAt?: number | null,
 *   payout?: string | null,
 *   recipient: string,
 *   route: import("./cardRoutes").CardRoute,
 *   stage: "arrived" | "failed" | "paid" | "sending" | "sent",
 * }} RouteTransfer
 *   `hash` the transaction that started it: on its chain for a migration,
 *   on Dusk for a transfer out; `at` when that was sent, null for a
 *   migration known only by its payout; `payout` what paid it on the other
 *   side.
 */

/** @returns {KeptMigration[]} */
function readKept() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "[]");

    return Array.isArray(kept)
      ? kept.filter(
          (item) =>
            EVM_HASH.test(String(item?.hash)) &&
            /^\d+$/.test(String(item?.amountLux)) &&
            typeof item?.routeId === "string"
        )
      : [];
  } catch {
    return [];
  }
}

const kept = writable(readKept());

/** The migrations this browser sent, newest first. */
export const keptMigrations = { subscribe: kept.subscribe };

/**
 * Reads the migrations this browser kept again, as another tab may have
 * kept one since.
 */
export const hydrateMigrations = () => kept.set(readKept());

/** @param {KeptMigration[]} items */
function writeKept(items) {
  const next = items.slice(0, MAX_KEPT);

  kept.set(next);

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Keeps a migration this browser sent, to follow it until it's paid.
 *
 * @param {Omit<KeptMigration, "confirmed" | "failed">} migration
 */
export function rememberMigration(migration) {
  const hash = migration.hash.toLowerCase();

  writeKept([
    { ...migration, hash },
    ...get(kept).filter((item) => item.hash !== hash),
  ]);
}

/**
 * Marks what a migration's receipt on its chain said.
 *
 * @param {string} hash
 * @param {{ confirmed: true } | { failed: true }} receipt
 */
const markMigration = (hash, receipt) =>
  writeKept(
    get(kept).map((item) =>
      item.hash === hash.toLowerCase() ? { ...item, ...receipt } : item
    )
  );

/**
 * Marks a migration whose transaction went through on its chain: it's
 * paid out next.
 *
 * @param {string} hash
 */
export const markMigrationConfirmed = (hash) =>
  markMigration(hash, { confirmed: true });

/**
 * Marks a migration whose transaction reverted on its chain.
 *
 * @param {string} hash
 */
export const markMigrationFailed = (hash) =>
  markMigration(hash, { failed: true });

/** @param {unknown} value */
const luxOf = (value) => {
  try {
    return BigInt(String(value ?? ""));
  } catch {
    return -1n;
  }
};

/**
 * The payout of a migration in the history: a public transfer in from the
 * route's payout account, with the migration's hash as the memo, of exactly
 * the amount.
 *
 * @param {ActivityRow[]} rows
 * @param {{ amountLux: bigint | string, hash: string, payoutAccount: string | null }} migration
 */
export const payoutOf = (rows, { amountLux, hash, payoutAccount }) =>
  rows.find(
    (row) =>
      row.direction === "in" &&
      row.privacy !== "shielded" &&
      String(row.memo ?? "")
        .trim()
        .toLowerCase() === hash.toLowerCase() &&
      row.value === luxOf(amountLux) &&
      (!payoutAccount || row.counterparty === payoutAccount)
  ) ?? null;

/**
 * A migration this browser sent, as Bridge › Activity lists it: sending
 * until it's in a block on its chain, sent until the history has its
 * payout, then paid; failed when it reverted.
 *
 * @param {KeptMigration} item
 * @param {ActivityRow[]} rows The history
 * @param {import("./cardRoutes").CardRoute & { kind: "migration" }} route
 * @returns {RouteTransfer}
 */
function sentMigration(item, rows, route) {
  const payout = payoutOf(rows, {
    amountLux: item.amountLux,
    hash: item.hash,
    payoutAccount: route.payoutAccount,
  });

  return {
    amountLux: BigInt(item.amountLux),
    at: item.createdAt,
    hash: item.hash,
    kind: "migration",
    paidAt: payout?.time ?? null,
    payout: payout?.hash ?? null,
    recipient: item.recipient,
    route,
    stage: payout
      ? "paid"
      : item.failed
        ? "failed"
        : item.confirmed
          ? "sent"
          : "sending",
  };
}

/**
 * A migration's payout in the history, from a route's payout account with
 * a migration's hash as the memo, as Bridge › Activity lists it; null for
 * any other row. When the migration was sent isn't known from its payout.
 *
 * @param {ActivityRow} row
 * @param {(import("./cardRoutes").CardRoute & { kind: "migration" })[]} migrations
 * @returns {RouteTransfer | null}
 */
function paidMigration(row, migrations) {
  const memo = String(row.memo ?? "")
    .trim()
    .toLowerCase();
  const route = migrations.find(
    ({ payoutAccount }) =>
      Boolean(payoutAccount) && row.counterparty === payoutAccount
  );

  return route && row.direction === "in" && EVM_HASH.test(memo)
    ? {
        amountLux: row.value,
        at: null,
        hash: memo,
        kind: "migration",
        paidAt: row.time,
        payout: row.hash,
        recipient: "",
        route,
        stage: "paid",
      }
    : null;
}

/**
 * The migrations into Dusk: those this browser sent to the account the
 * wallet shows, and the payouts in its history of migrations sent
 * elsewhere, each once.
 *
 * @param {ActivityRow[]} rows The history
 * @param {KeptMigration[]} sent The migrations this browser sent
 * @param {import("./cardRoutes").CardRoute[]} routes The network's
 * @param {string} account The public account the wallet shows
 * @returns {RouteTransfer[]}
 */
export function migrationTransfers(rows, sent, routes, account) {
  const migrations =
    /** @type {(import("./cardRoutes").CardRoute & { kind: "migration" })[]} */ (
      routes.filter(({ kind }) => kind === "migration")
    );
  /** @type {Map<string, RouteTransfer>} */
  const byHash = new Map();

  for (const item of sent) {
    const route = migrations.find(({ id }) => id === item.routeId);

    if (route && item.recipient === account) {
      byHash.set(item.hash, sentMigration(item, rows, route));
    }
  }

  // Payouts of migrations sent from another device or before.
  for (const row of rows) {
    const paid = paidMigration(row, migrations);

    if (paid && !byHash.has(paid.hash)) {
      byHash.set(paid.hash, paid);
    }
  }

  return [...byHash.values()];
}

/**
 * Kept arrivals of transfers out, by their Dusk transaction: where the
 * search for the payout got to, and the payout once found.
 *
 * @typedef {{ arrivedAt?: number | null, payout?: string | null, scanFrom?: string }} ArrivalSearch
 */

const ARRIVALS_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-transfer-arrivals`;

/** @returns {Record<string, ArrivalSearch>} */
function readArrivals() {
  try {
    const stored = JSON.parse(localStorage.getItem(ARRIVALS_KEY) ?? "{}");

    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

const arrivals = writable(readArrivals());

/** What's known of each transfer out's arrival. */
export const transferArrivals = { subscribe: arrivals.subscribe };

/**
 * Keeps what's known of a transfer out's arrival.
 *
 * @param {string} hash Its Dusk transaction
 * @param {ArrivalSearch} found
 */
export function keepArrival(hash, found) {
  const next = {
    ...get(arrivals),
    [hash]: { ...get(arrivals)[hash], ...found },
  };

  arrivals.set(next);

  try {
    localStorage.setItem(ARRIVALS_KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * Forgets the migrations and transfers out this browser follows, as
 * Settings › Reset forgets the wallet they're for.
 */
export function forgetRouteTransfers() {
  kept.set([]);
  arrivals.set({});

  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ARRIVALS_KEY);
  } catch {
    // Nothing was kept.
  }
}

/**
 * Why a transfer to a route's account pays nothing out, or "".
 *
 * @param {ActivityRow} row
 * @param {bigint} feeLux
 */
function failureOf(row, feeLux) {
  if (row.status === "failed") {
    return "The transfer failed on Dusk";
  }

  if (row.value <= feeLux) {
    return "It was no more than the bridge fee: nothing is paid out";
  }

  return EVM_ADDRESS.test(String(row.memo ?? "").trim())
    ? ""
    : "The memo isn't an address: the bridge can't pay it out";
}

/**
 * The transfers out to another chain in the history: public transfers to a
 * route's account, sent until they arrive.
 *
 * @param {ActivityRow[]} rows The history
 * @param {Record<string, ArrivalSearch>} known What's known of their arrivals
 * @param {import("./cardRoutes").CardRoute[]} routes The network's
 * @returns {RouteTransfer[]}
 */
export function serviceTransfers(rows, known, routes) {
  const services = routes.filter(({ kind }) => kind === "service");

  return rows.flatMap((row) => {
    const route = services.find(
      (each) => each.kind === "service" && row.counterparty === each.account
    );

    if (!route || route.kind !== "service" || row.direction !== "out") {
      return [];
    }

    const failure = failureOf(row, route.feeLux);
    const arrival = known[row.hash] ?? {};

    return [
      {
        amountLux: row.value,
        arrivedAt: arrival.arrivedAt ?? null,
        at: row.time ?? 0,
        failure: failure || undefined,
        feeLux: route.feeLux,
        hash: row.hash,
        kind: /** @type {const} */ ("service"),
        payout: arrival.payout ?? null,
        recipient: String(row.memo ?? "").trim(),
        route,
        stage: failure ? "failed" : arrival.payout ? "arrived" : "sent",
      },
    ];
  });
}

/**
 * What a transfer out pays on its chain, in the token's wei: the amount
 * less the bridge's fee.
 *
 * @param {RouteTransfer} transfer
 */
export const arrivingWei = (transfer) =>
  (transfer.amountLux - (transfer.feeLux ?? 0n)) * WEI_PER_LUX;
