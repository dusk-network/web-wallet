/**
 * How a route is doing before someone sends, as far as the chains say
 * (`@dusk-network/app-core/bridge`): read as its card opens, and said in a line
 * under the route, in the words of the Dusk Bridge. It's only ever said: nothing
 * waits for it, and nothing it says stops anyone from sending.
 */

import { STATUS_MAX_AGE_MS, bridgeStatus } from "@dusk-network/app-core/bridge";
import { durationWords } from "@dusk-network/networks/format";
import { writable } from "svelte/store";

import { formatDusk } from "$lib/dusk/currency";
import { nodeBaseUrl } from "$lib/url";

import { bridgeNetwork } from "./bridgeCalls";

/**
 * What a route's line is said from.
 *
 * @typedef {Pick<import("@dusk-network/app-core/bridge").BridgeStatus, "canPay" | "lastPayout" | "limit" | "paying" | "readSince">} RouteStatus
 */

/** A read that failed outright: it says it doesn't know, like a part that couldn't be read. */
const UNKNOWN = Object.freeze({
  canPay: null,
  lastPayout: null,
  limit: /** @type {const} */ ("mints"),
  paying: /** @type {const} */ ("unknown"),
  readSince: null,
});

/** What was read of each route, by its ID, as it comes in. */
const known = writable(/** @type {Map<string, RouteStatus>} */ (new Map()));

/** When each route was asked for last, by its ID and network. */
const asked = new Map();

/** What `bridgeStatus` keeps of its reads, while the wallet's page is open. */
const kept = new Map();

export const routeStatuses = { subscribe: known.subscribe };

/**
 * Reads a route, once as its card opens and again once what was read is old.
 * A route that isn't running says so itself.
 *
 * @param {{ id: string, running?: boolean } | null | undefined} route
 * @param {number} [now]
 */
export function openRouteStatus(route, now = Date.now()) {
  const net = bridgeNetwork();

  if (!route?.running || !net) {
    return;
  }

  const key = `${net.name} ${route.id}`;

  if (now - (asked.get(key) ?? -STATUS_MAX_AGE_MS) < STATUS_MAX_AGE_MS) {
    return;
  }

  asked.set(key, now);
  Promise.resolve()
    .then(() =>
      bridgeStatus({
        cache: kept,
        network: net,
        nodeUrl: nodeBaseUrl(),
        route: route.id,
      })
    )
    .catch(() => UNKNOWN)
    .then((status) => {
      known.update((statuses) => new Map(statuses).set(route.id, status));
    });
}

/** @param {number} ms */
const dayOf = (ms) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    ms
  );

/**
 * "Last payout 12 minutes ago.", where the chains gave its time.
 *
 * @param {RouteStatus} status
 * @param {number} now
 */
const lastPayoutWords = ({ lastPayout }, now) =>
  lastPayout?.at
    ? `Last payout ${durationWords(Math.max(0, now - lastPayout.at) / 1_000)} ago.`
    : "";

/**
 * A route's status in a line, for under its route: `text`, and `warn` where it
 * could make someone wait. Null with nothing to say: nothing read yet, or a route
 * that isn't running, which its card says itself. "unknown" says it doesn't know,
 * not that anything is wrong.
 *
 * @param {RouteStatus | null | undefined} status
 * @param {{ amountLux?: bigint | null, locale?: string, now?: number }} [options]
 *   `amountLux` is what's being sent
 * @returns {{ text: string, warn: boolean } | null}
 */
export function statusLine(
  status,
  { amountLux = null, locale, now = Date.now() } = {}
) {
  if (!status || status.paying === "stopped") {
    return null;
  }

  const last = lastPayoutWords(status, now);

  /** @type {Record<string, string[]>} */
  const said = {
    late: ["Payouts are running late.", last],
    "on-claim": ["It pays when you claim it."],
    quiet: [
      last ||
        (status.readSince
          ? `No payouts since ${dayOf(status.readSince)}.`
          : "No recent payouts."),
    ],
    unknown: ["Last payout not known right now."],
    yes: ["Paying out.", last],
  };
  const words = said[status.paying];

  if (!words) {
    return null;
  }

  const { canPay } = status;
  const pays =
    status.limit === "balance" && canPay !== null
      ? formatDusk(canPay, locale)
      : "";
  const short =
    Boolean(pays) &&
    amountLux !== null &&
    amountLux > /** @type {bigint} */ (canPay);
  const room = !pays
    ? ""
    : short
      ? `It can pay up to ${pays} DUSK now, less than you're sending, so yours may wait.`
      : `It can pay up to ${pays} DUSK.`;

  return {
    text: [...words, room].filter(Boolean).join(" "),
    warn: status.paying === "late" || short,
  };
}
