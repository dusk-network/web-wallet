/**
 * Migrations into Dusk and transfers out to another chain, for Bridge ›
 * Activity, as the bridge site follows them
 * (`@dusk-network/app-core/bridge`, loaded once there's one):
 * - a migration from BNB Smart Chain or Ethereum is sent there, then paid
 *   on Dusk: its route's payout account pays this account the amount, with
 *   the migration's transaction hash as the memo. The history has the
 *   payout; this browser keeps the migrations it sent until it does.
 * - a transfer to another chain is a public transfer to the route's
 *   account, with the address it pays as the memo: sent until the chain's
 *   DUSK token pays that address the amount less the bridge's fee.
 */

import { routeForAccount } from "@dusk-network/networks";

import { walletDataScope, writesFor } from "$lib/wallets/dataNames";
import {
  recordsInMemory,
  storeRecords,
  withRefused,
  withRefusedByKey,
} from "$lib/wallets/recordsInMemory";

import { cardRoutes } from "./cardRoutes";

/** How many migrations this browser keeps. */
const MAX_KEPT = 50;

/** The migrations kept, each wallet's under its own name (walletDataScope). */
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

/**
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 * @returns {KeptMigration[]}
 */
function readKept(scope = walletDataScope()) {
  try {
    const kept = JSON.parse(localStorage.getItem(scope.name(KEY)) ?? "[]");

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

const kept = recordsInMemory(/** @type {KeptMigration[]} */ ([]));

/** The migrations this browser sent, newest first. */
export const keptMigrations = { subscribe: kept.subscribe };

/**
 * A wallet's migrations: as storage keeps them, with those it refused.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 */
const keptOf = (scope) =>
  withRefused(readKept(scope), kept.refusedOf(scope), ({ hash }) => hash);

/**
 * Reads the migrations this browser kept again, and what's known of the
 * transfers out, as another tab may have kept one since, or another wallet
 * opened.
 */
export function hydrateMigrations() {
  const scope = walletDataScope();

  kept.show(keptOf(scope));
  arrivals.show(arrivalsOf(scope));
}

/**
 * Changes the migrations a wallet keeps, as they're kept now, in storage
 * and in this tab: in its own place, whichever wallet is open; shown with
 * the change while it's the one open. Nothing, once that wallet's time here
 * ended.
 *
 * @param {(items: KeptMigration[]) => KeptMigration[]} change
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 */
function changeKept(change, scope) {
  if (!writesFor(scope)) {
    return;
  }

  const next = change(keptOf(scope)).slice(0, MAX_KEPT);

  kept.keep(next, scope, storeRecords(scope.name(KEY), next));
}

/**
 * Keeps a migration this browser sent, to follow it until it's paid: for
 * the wallet it was sent for (`scope`, taken as it was sent).
 *
 * @param {Omit<KeptMigration, "confirmed" | "failed">} migration
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 */
export function rememberMigration(migration, scope = walletDataScope()) {
  const hash = migration.hash.toLowerCase();

  changeKept(
    (items) => [
      { ...migration, hash },
      ...items.filter((item) => item.hash !== hash),
    ],
    scope
  );
}

/**
 * Marks what a migration's receipt on its chain said.
 *
 * @param {string} hash
 * @param {{ confirmed: true } | { failed: true }} receipt
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 */
const markMigration = (hash, receipt, scope) =>
  changeKept(
    (items) =>
      items.map((item) =>
        item.hash === hash.toLowerCase() ? { ...item, ...receipt } : item
      ),
    scope
  );

/**
 * Marks a migration whose transaction went through on its chain: it's
 * paid out next.
 *
 * @param {string} hash
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 */
export const markMigrationConfirmed = (hash, scope = walletDataScope()) =>
  markMigration(hash, { confirmed: true }, scope);

/**
 * Marks a migration whose transaction reverted on its chain.
 *
 * @param {string} hash
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 */
export const markMigrationFailed = (hash, scope = walletDataScope()) =>
  markMigration(hash, { failed: true }, scope);

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
  const { migrationPayouts } = await import("@dusk-network/app-core/bridge");
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
  /** @param {string | null} id */
  const routeOf = (id) => routes.find((route) => route.id === id);
  // When each payout was, as the history shows it.
  const times = new Map(rows.map(({ hash, time }) => [hash, time]));
  // Payouts of migrations sent from another device or before, each once:
  // not one on a route the network doesn't name.
  const elsewhere = new Map(
    unlisted.flatMap((payout) => {
      const route = routeOf(payout.route);

      return route ? [[payout.hash, { ...payout, route }]] : [];
    })
  );

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
    ...[...elsewhere.values()].map(
      (payout) =>
        /** @type {RouteTransfer} */ ({
          amountLux: payout.amount,
          at: null,
          hash: payout.hash,
          kind: "migration",
          paidAt: times.get(payout.payout) ?? payout.at,
          payout: payout.payout,
          recipient: "",
          route: payout.route,
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

/**
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 * @returns {Record<string, ArrivalSearch>}
 */
function readArrivals(scope = walletDataScope()) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(scope.name(ARRIVALS_KEY)) ?? "{}"
    );

    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

const arrivals = recordsInMemory(
  /** @type {Record<string, ArrivalSearch>} */ ({})
);

/** What's known of each transfer out's arrival. */
export const transferArrivals = { subscribe: arrivals.subscribe };

/**
 * What a wallet knows of its transfers out's arrivals: as storage keeps it,
 * with what it refused.
 *
 * @param {import("$lib/wallets/dataNames").WalletDataScope} scope
 */
const arrivalsOf = (scope) =>
  withRefusedByKey(readArrivals(scope), arrivals.refusedOf(scope));

/**
 * Keeps what's known of a transfer out's arrival: for the wallet whose
 * search found it (`scope`, taken as the search began), in storage and in
 * this tab. Nothing, once that wallet's time here ended.
 *
 * @param {string} hash Its Dusk transaction
 * @param {ArrivalSearch} found
 * @param {import("$lib/wallets/dataNames").WalletDataScope} [scope]
 */
export function keepArrival(hash, found, scope = walletDataScope()) {
  if (!writesFor(scope)) {
    return;
  }

  const known = arrivalsOf(scope);
  const next = { ...known, [hash]: { ...known[hash], ...found } };

  arrivals.keep(next, scope, storeRecords(scope.name(ARRIVALS_KEY), next));
}

/**
 * Forgets the migrations and transfers out this browser follows, every
 * wallet's, as Settings › Reset forgets the wallets they're for.
 */
export function forgetRouteTransfers() {
  kept.clear();
  arrivals.clear();

  try {
    for (const key of Object.keys(localStorage)) {
      if ([KEY, ARRIVALS_KEY].some((name) => key.startsWith(name))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing was kept.
  }
}

/**
 * Forgets the migrations and transfers out one wallet follows, as it's
 * removed, by the ending of its names ($lib/wallets/dataNames).
 *
 * @param {string} suffix
 */
export function forgetWalletRouteTransfers(suffix) {
  try {
    localStorage.removeItem(`${KEY}${suffix}`);
    localStorage.removeItem(`${ARRIVALS_KEY}${suffix}`);
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
 * @returns {Promise<RouteTransfer[]>}
 */
export async function serviceTransfers(rows, known, net) {
  const { serviceTransferOf } = await import("@dusk-network/app-core/bridge");
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
 * Whether there can be a transfer between Dusk and another chain of the
 * account: a migration sent from here to it, or a row with one of the
 * bridge's accounts.
 *
 * @param {ActivityRow[]} rows
 * @param {KeptMigration[]} sent
 * @param {import("@dusk-network/networks").Network} net
 * @param {string} account
 */
const hasRouteTransfers = (rows, sent, net, account) =>
  sent.some(({ recipient }) => recipient === account) ||
  rows.some(
    ({ counterparty, direction }) =>
      Boolean(counterparty) &&
      (direction === "in" || direction === "out") &&
      routeForAccount(net, String(counterparty), direction) !== null
  );

/**
 * The transfers between Dusk and another chain, as Bridge › Activity lists
 * them: the migrations into Dusk, then the transfers out. None without a
 * network, or without one of them.
 *
 * @param {{ account: string, known: Record<string, ArrivalSearch>, net: import("@dusk-network/networks").Network | null, rows: ActivityRow[], sent: KeptMigration[] }} state
 *   `known` what's known of the transfers out's arrivals; `sent` the
 *   migrations this browser sent
 * @returns {Promise<RouteTransfer[]>}
 */
export const routeTransfersOf = async ({ account, known, net, rows, sent }) =>
  net && hasRouteTransfers(rows, sent, net, account)
    ? [
        ...(await migrationTransfers(rows, sent, net, account)),
        ...(await serviceTransfers(rows, known, net)),
      ]
    : [];

// What the wallet open, or the one of before, keeps, shown from the start.
hydrateMigrations();
