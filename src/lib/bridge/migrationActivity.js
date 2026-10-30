/**
 * Migrations into Dusk and transfers out to another chain, for Bridge ›
 * Activity, as the bridge site follows them
 * (`@dusk-network/app-core/bridge`):
 * - a migration from BNB Smart Chain or Ethereum is sent there, then paid
 *   on Dusk: its route's payout account pays this account the amount, with
 *   the migration's transaction hash as the memo. The history has the
 *   payout; this browser keeps the migrations it sent until it does.
 * - a transfer to another chain is a public transfer to the route's
 *   account, with the address it pays as the memo: sent until the chain's
 *   DUSK token pays that address the amount less the bridge's fee.
 */

import {
  migrationPayouts,
  serviceTransferOf,
} from "@dusk-network/app-core/bridge";
import { get, writable } from "svelte/store";

import { cardRoutes } from "./cardRoutes";

/** How many migrations this browser keeps. */
const MAX_KEPT = 50;

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`;

const EVM_HASH = /^0x[0-9a-f]{64}$/;

/** Why a transfer to a route's account pays nothing out. */
const FAILURES = {
  failed: "The transfer failed on Dusk",
  "no-address": "The memo isn't an address: the bridge can't pay it out",
  "under-fee": "It was no more than the bridge fee: nothing is paid out",
};

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

/**
 * The migrations into Dusk: those this browser sent to the account the
 * wallet shows, sending until they're in a block on their chain, sent until
 * the history has their payout, then paid, or failed when they reverted;
 * and the payouts in its history of migrations sent elsewhere, paid. When
 * one of those was sent isn't known from its payout.
 *
 * @param {ActivityRow[]} rows The history
 * @param {KeptMigration[]} sent The migrations this browser sent
 * @param {import("@dusk-network/networks").Network} net
 * @param {string} account The public account the wallet shows
 * @returns {Promise<RouteTransfer[]>}
 */
export async function migrationTransfers(rows, sent, net, account) {
  const routes = cardRoutes(net);
  const mine = sent.filter(
    (item) =>
      item.recipient === account &&
      routes.some(({ id, kind }) => id === item.routeId && kind === "migration")
  );
  const { payouts, unlisted } = await migrationPayouts({
    entries: rows.flatMap(({ entry }) => (entry ? [entry] : [])),
    migrations: mine.map(({ amountLux, createdAt, hash, routeId }) => ({
      amount: amountLux,
      at: createdAt,
      hash,
      route: routeId,
    })),
    network: net,
  });
  /** @param {string} id */
  const routeOf = (id) =>
    /** @type {import("./cardRoutes").CardRoute} */ (
      routes.find((route) => route.id === id)
    );
  // When each payout was, as the history shows it.
  const times = new Map(rows.map(({ hash, time }) => [hash, time]));

  return [
    ...mine.map((item) => {
      const paid = payouts.get(item.hash);
      const payout = paid?.state === "arrived" ? paid : null;

      return /** @type {RouteTransfer} */ ({
        amountLux: BigInt(item.amountLux),
        at: item.createdAt,
        hash: item.hash,
        kind: "migration",
        paidAt: payout ? (times.get(payout.hash) ?? payout.at) : null,
        payout: payout?.hash ?? null,
        recipient: item.recipient,
        route: routeOf(item.routeId),
        stage: payout
          ? "paid"
          : item.failed
            ? "failed"
            : item.confirmed
              ? "sent"
              : "sending",
      });
    }),
    // Payouts of migrations sent from another device or before, each once.
    ...[...new Map(unlisted.map((each) => [each.hash, each])).values()].map(
      (payout) =>
        /** @type {RouteTransfer} */ ({
          amountLux: payout.amount,
          at: null,
          hash: payout.hash,
          kind: "migration",
          paidAt: times.get(payout.payout) ?? payout.at,
          payout: payout.payout,
          recipient: "",
          route: routeOf(payout.route),
          stage: "paid",
        })
    ),
  ];
}

/**
 * Kept arrivals of transfers out, by their Dusk transaction: where the
 * search for the payout got to, and the payout once found.
 *
 * @typedef {{ arrivedAt?: number | null, payout?: string | null, scan?: import("@dusk-network/app-core/bridge").Scan }} ArrivalSearch
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
 * A row as the history's entry of it, which the wallet's own record of a
 * send stands for until the history has it: one the wallet saw fail failed.
 *
 * @param {ActivityRow} row
 * @returns {import("@dusk-network/app-core/bridge").HistoryLike}
 */
const entryOf = (row) => ({
  blockHeight: row.blockHeight ?? 0,
  counterparty: row.counterparty,
  direction: row.direction,
  hash: row.hash,
  kind: row.kind ?? "transfer",
  memo: row.memo ?? "",
  payer: true,
  success: row.status === "failed" ? false : row.success,
  value: row.value,
});

/**
 * The transfers out to another chain in the history: public transfers to a
 * route's account, sent until they arrive, or failed where they pay nothing
 * out, as the route's bridge reads them.
 *
 * @param {ActivityRow[]} rows The history
 * @param {Record<string, ArrivalSearch>} known What's known of their arrivals
 * @param {import("@dusk-network/networks").Network} net
 * @returns {RouteTransfer[]}
 */
export function serviceTransfers(rows, known, net) {
  const routes = cardRoutes(net);

  return rows.flatMap((row) => {
    const facts = serviceTransferOf(entryOf(row), net);
    const route = routes.find(({ id }) => id === facts?.route);

    if (!facts || !route) {
      return [];
    }

    const failure = facts.problem ? FAILURES[facts.problem] : undefined;
    const arrival = known[row.hash] ?? {};

    return [
      {
        amountLux: row.value,
        arrivedAt: arrival.arrivedAt ?? null,
        at: row.time ?? 0,
        failure,
        feeLux: facts.fee,
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
 * The transfers between Dusk and another chain, as Bridge › Activity lists
 * them: the migrations into Dusk, then the transfers out. None without a
 * network.
 *
 * @param {{ account: string, known: Record<string, ArrivalSearch>, net: import("@dusk-network/networks").Network | null, rows: ActivityRow[], sent: KeptMigration[] }} state
 *   `known` what's known of the transfers out's arrivals; `sent` the
 *   migrations this browser sent
 * @returns {Promise<RouteTransfer[]>}
 */
export const routeTransfersOf = async ({ account, known, net, rows, sent }) =>
  net
    ? [
        ...(await migrationTransfers(rows, sent, net, account)),
        ...serviceTransfers(rows, known, net),
      ]
    : [];
