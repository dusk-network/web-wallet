/**
 * How long a bridge or migration route takes on this network: the one
 * answer the Bridge and Migrate cards, their reviews and their results give.
 * Each time comes from the most direct source there is, on this network
 * only, and where none is known there is no time, never another network's:
 * - a withdrawal from DuskEVM: the Portal's proof maturity and dispute game
 *   finality delays, and how often DuskEVM's outputs reach Dusk (chain);
 * - a deposit to DuskEVM: how far DuskEVM trails Dusk (chain), or else the
 *   network's value below;
 * - a migration: the network's value below.
 */

/** Dusk makes a block every 10 seconds: a deposit waits for one. */
const DUSK_BLOCK_SECONDS = 10;

/**
 * What a route takes on each network where the chain doesn't say, in
 * seconds, and where each number comes from. null: not known, no time.
 */
const CONFIGURED = Object.freeze({
  mainnet: Object.freeze({
    // DuskEVM isn't on mainnet yet: its chains will say, once it is.
    deposit: null,
    migration: Object.freeze({
      // "Around one hour", as the docs' migration guide says. Not measured:
      // the payouts of the 200 days to 27 Oct 2026 were all for Ethereum.
      bsc: 3_600,
      // 66 to 67 minutes from the migration's block to its payout on Dusk,
      // for each of the 15 migrations of 28 Sep to 24 Oct 2026.
      ethereum: 4_000,
    }),
  }),
  testnet: Object.freeze({
    // Its 40 deposits of 1 Sep to 27 Oct 2026 took 25 to 39 s from their
    // Dusk block (Dusk's own time) to their DuskEVM block, plus up to a Dusk
    // block to be included.
    deposit: 60,
    // No time: the testnet migrations are paid out only at times (one payout
    // since January 2025).
    migration: Object.freeze({ bsc: null, ethereum: null }),
  }),
});

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
 * A withdrawal's time, as the chain says it: until it can be proved
 * (`report`), and from the proof to the claim (`wait`).
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

  return { report, seconds: report + wait, source: "chain", wait };
}

/**
 * What a route takes on `network` as configured above, or null.
 *
 * @param {RouteTimeRoute} route
 * @param {string} network
 */
function configured(route, network) {
  if (!Object.hasOwn(CONFIGURED, network)) {
    return null;
  }

  const values = CONFIGURED[/** @type {keyof typeof CONFIGURED} */ (network)];

  return route.kind === "deposit"
    ? values.deposit
    : (values.migration[
        /** @type {"bsc" | "ethereum"} */ (route.from ?? "ethereum")
      ] ?? null);
}

/**
 * How long `route` usually takes on `network`, or null when nothing says. A
 * withdrawal also gives its parts: `report`, until it can be proved, and
 * `wait`, from the proof to the claim.
 *
 * @param {RouteTimeRoute} route
 * @param {{ chain?: ChainTimes | null, network?: string }} [timing]
 * @returns {RouteTime | null}
 */
export function routeTime(route, { chain = null, network = "" } = {}) {
  if (route.kind === "withdrawal") {
    return withdrawalTime(chain?.withdrawal);
  }

  if (route.kind === "deposit" && chain?.deposit) {
    return {
      seconds: chain.deposit.lagSeconds + DUSK_BLOCK_SECONDS,
      source: "chain",
    };
  }

  const seconds = configured(route, network);

  return seconds ? { seconds, source: "config" } : null;
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
