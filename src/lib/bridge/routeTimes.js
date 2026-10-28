/**
 * How long a bridge route takes on this network: the one answer the Bridge
 * card, its reviews and its results, and Bridge › Activity give. Each time
 * comes from the most direct source there is, on this network only, and
 * where none is known there is no time, never another network's:
 * - a withdrawal from DuskEVM: the Portal's proof maturity and dispute game
 *   finality delays, and how often DuskEVM's outputs reach Dusk (chain);
 * - a deposit to DuskEVM: how far DuskEVM trails Dusk (chain), or else the
 *   route's typical time in the network's file;
 * - a migration or a transfer to another chain: the route's typical time in
 *   the network's file (`@dusk-network/networks`).
 */

import { routes } from "@dusk-network/networks";

/** Dusk makes a block every 10 seconds: a deposit waits for one. */
const DUSK_BLOCK_SECONDS = 10;

/** A deposit from Dusk to DuskEVM. */
export const DEPOSIT = Object.freeze({ kind: "deposit" });

/** A withdrawal from DuskEVM to Dusk. */
export const WITHDRAWAL = Object.freeze({ kind: "withdrawal" });

/**
 * A migration of old DUSK from `from`, "ethereum" or "bsc".
 *
 * @param {string} from
 * @returns {RouteTimeRoute}
 */
export const migrationRoute = (from) => ({ from, kind: "migration" });

/**
 * A withdrawal's time, as the chain says it: about when it can be proved,
 * an output after it's sent (`prove`); when it's late to be (`report`, two
 * outputs); the Portal's wait from a proof to its claim (`maturity`); and
 * the longer of that and the game's finality (`wait`).
 *
 * @param {ChainTimes["withdrawal"]} read
 * @returns {RouteTime | null}
 */
function withdrawalTime(read) {
  if (!read?.outputSeconds || !read.maturitySeconds) {
    return null;
  }

  // An output covers DuskEVM up to about when its batch reached Dusk, and
  // the batcher posts at least as often as outputs come: a withdrawal waits
  // at most about two outputs to be reported.
  const report = 2 * read.outputSeconds;
  const wait = Math.max(read.maturitySeconds, read.finalitySeconds ?? 0);

  return {
    maturity: read.maturitySeconds,
    prove: read.outputSeconds,
    report,
    seconds: report + wait,
    source: "chain",
    wait,
  };
}

/**
 * A route's typical time in the network's file, in seconds, or null: the
 * route itself when it's one of the file's, else the file's route of its
 * kind.
 *
 * @param {RouteTimeRoute | import("@dusk-network/networks").Route} route
 * @param {import("@dusk-network/networks").Network | null} net
 */
function typicalSeconds(route, net) {
  if ("typicalSeconds" in route) {
    return route.typicalSeconds ?? null;
  }

  const kind =
    route.kind === "deposit"
      ? "duskevm-deposit"
      : route.kind === "migration"
        ? "migration"
        : null;
  const found = net
    ? routes(net).find(
        (each) =>
          each.kind === kind &&
          (kind !== "migration" || each.from === route.from)
      )
    : null;

  return found?.typicalSeconds ?? null;
}

/**
 * How long `route` usually takes on the network, or null when nothing says.
 * A withdrawal also gives its parts, as `withdrawalTime` says.
 *
 * @param {RouteTimeRoute | import("@dusk-network/networks").Route} route
 * @param {{ chain?: ChainTimes | null, net?: import("@dusk-network/networks").Network | null }} [timing]
 * @returns {RouteTime | null}
 */
export function routeTime(route, { chain = null, net = null } = {}) {
  if (route.kind === "withdrawal" || route.kind === "duskevm-withdrawal") {
    return withdrawalTime(chain?.withdrawal);
  }

  if (
    (route.kind === "deposit" || route.kind === "duskevm-deposit") &&
    chain?.deposit
  ) {
    return {
      seconds: chain.deposit.lagSeconds + DUSK_BLOCK_SECONDS,
      source: "chain",
    };
  }

  const seconds = typicalSeconds(route, net);

  return seconds ? { seconds, source: "network" } : null;
}

/**
 * A time as an estimate, rounded up on a scale that reads at a glance:
 * "~1 min", "~15 min", "~1 hour", "~70 min", "~10 hours", "~7 days".
 *
 * @param {number} seconds
 */
export function aboutTime(seconds) {
  let minutes = Math.max(1, Math.ceil(Number(seconds) / 60));

  if (minutes > 10 && minutes < 60) {
    minutes = Math.ceil(minutes / 5) * 5;
  } else if (minutes > 60 && minutes <= 90) {
    minutes = Math.ceil(minutes / 10) * 10;
  }

  if (minutes < 60) {
    return `~${minutes} min`;
  }

  if (minutes === 60) {
    return "~1 hour";
  }

  if (minutes <= 90) {
    return `~${minutes} min`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 48
    ? `~${hours} hours`
    : `~${Math.round(minutes / 1_440)} days`;
}

/**
 * The route's time as every page writes it, or "" when it isn't known.
 *
 * @param {RouteTime | null} time
 */
export const routeTimeText = (time) => (time ? aboutTime(time.seconds) : "");
