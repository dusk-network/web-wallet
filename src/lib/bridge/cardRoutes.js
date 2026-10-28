/**
 * The Bridge card's routes, as the network's file gives them
 * (`@dusk-network/networks`): which networks pair into a route, the choices
 * each side offers, what the flip does, and which route the card opens on.
 * A route that isn't running is listed, and can't be picked: it says why.
 * Pure: the network comes in.
 */

import { routes } from "@dusk-network/networks";

/**
 * A route as the card shows it: the file's, with its ends as the network
 * marks name them ("duskDs", "duskEvm", "bsc", "ethereum").
 *
 * @typedef {import("@dusk-network/networks").Route & { destination: string, origin: string }} CardRoute
 *
 * @typedef {{ disabled?: string, id: string, name: string, note?: string }} CardChoice
 *   `disabled` says why it can't be picked.
 */

/** The card's networks, in the order its lists show them. */
const ORDER = ["ethereum", "bsc", "duskDs", "duskEvm"];

/** @param {string} id A route's end, as the file names it */
const markOf = (id) =>
  id === "dusk" ? "duskDs" : id === "dusk-evm" ? "duskEvm" : id;

/**
 * The network's routes, running or not; none without a network.
 *
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 * @returns {CardRoute[]}
 */
export const cardRoutes = (net) =>
  (net ? routes(net) : []).map((route) => ({
    ...route,
    destination: markOf(route.to),
    origin: markOf(route.from),
  }));

/**
 * The route from one network to another, or null.
 *
 * @param {CardRoute[]} list
 * @param {string} from
 * @param {string} to
 */
export const routeBetween = (list, from, to) =>
  list.find((route) => route.origin === from && route.destination === to) ??
  null;

/**
 * What the card calls a network: Dusk, DuskEVM, or the chain's name.
 *
 * @param {CardRoute[]} list
 * @param {string} id
 */
export function networkName(list, id) {
  if (id === "duskDs") {
    return "Dusk";
  }

  if (id === "duskEvm") {
    return "DuskEVM";
  }

  return list.find(({ chain }) => chain.id === id)?.chain.name ?? id;
}

/**
 * Why a route that isn't running can't be used: "Not running on testnet
 * right now".
 *
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 */
export const notRunning = (net) =>
  `Not running on ${net?.name ?? "this network"} right now`;

/** @param {CardRoute[]} list */
const networksOf = (list) =>
  ORDER.filter((id) =>
    list.some(({ destination, origin }) => origin === id || destination === id)
  );

/**
 * Each network as a From choice: one whose routes all aren't running says
 * so, unless it's the one picked.
 *
 * @param {CardRoute[]} list
 * @param {string} current
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 * @returns {CardChoice[]}
 */
export function fromChoices(list, current, net) {
  return networksOf(list).map((id) => {
    const name = networkName(list, id);
    const leaving = list.filter(({ origin }) => origin === id);

    if (!leaving.length) {
      return {
        disabled: `Nothing leaves ${name} through this bridge`,
        id,
        name,
      };
    }

    return leaving.every(({ running }) => !running) && id !== current
      ? { disabled: notRunning(net), id, name }
      : { id, name };
  });
}

/**
 * Each network as a To choice from `from`, with its route's line.
 *
 * @param {CardRoute[]} list
 * @param {string} from
 * @param {string} current
 * @param {import("@dusk-network/networks").Network | null | undefined} net
 * @param {(route: CardRoute) => string} [noteOf]
 * @returns {CardChoice[]}
 */
export function toChoices(list, from, current, net, noteOf = () => "") {
  return networksOf(list).map((id) => {
    const name = networkName(list, id);
    const route = routeBetween(list, from, id);

    if (id === from) {
      return { disabled: "It's where it comes from", id, name };
    }

    if (!route) {
      return {
        disabled: `No route from ${networkName(list, from)}`,
        id,
        name,
      };
    }

    return !route.running && id !== current
      ? { disabled: notRunning(net), id, name }
      : { id, name, note: noteOf(route) || undefined };
  });
}

/**
 * The route a pick makes: the one between `from` and `to`, else the first
 * running route from `from`. Null only when no route starts there.
 *
 * @param {CardRoute[]} list
 * @param {string} from
 * @param {string} to
 */
export function choosePair(list, from, to) {
  const direct = routeBetween(list, from, to);
  const leaving = list.filter(({ origin }) => origin === from);

  return (
    (direct?.running ? direct : null) ??
    leaving.find(({ running }) => running) ??
    direct ??
    leaving[0] ??
    null
  );
}

/**
 * Where the card opens: the route a link names, running or not, else Dusk
 * to DuskEVM, else a route from Dusk, running routes before others.
 *
 * @param {CardRoute[]} list
 * @param {string | null} [linked] A route's ID, as `?route=` gives it
 */
export function openingRoute(list, linked = null) {
  const byLink = linked ? list.find(({ id }) => id === linked) : undefined;
  /** @param {CardRoute[]} among */
  const pick = (among) =>
    routeBetween(among, "duskDs", "duskEvm") ??
    among.find(({ origin }) => origin === "duskDs") ??
    among[0] ??
    null;

  return byLink ?? pick(list.filter(({ running }) => running)) ?? pick(list);
}

/**
 * The way back, when the network has it running: what the flip swaps to.
 *
 * @param {CardRoute[]} list
 * @param {CardRoute | null} route
 */
export function flipRoute(list, route) {
  const back = route
    ? routeBetween(list, route.destination, route.origin)
    : null;

  return back?.running ? back : null;
}

/**
 * The migration routes into Dusk that are running, for whoever holds DUSK
 * on Ethereum or BNB Smart Chain: BNB Smart Chain's first, as the Home line
 * opens it.
 *
 * @param {CardRoute[]} list
 */
export const migrationRoutes = (list) =>
  list
    .filter(({ kind, running }) => kind === "migration" && running)
    .sort((a, b) => Number(b.from === "bsc") - Number(a.from === "bsc"));
