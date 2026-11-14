/**
 * A network as its file says it, with every route to and from another chain
 * stopped: listed, as its file lists one that isn't running, to follow what
 * was sent on it, and taken by none.
 *
 * @param {import("@dusk-network/networks").Network} net
 * @returns {import("@dusk-network/networks").Network}
 */
export default function routesStopped(net) {
  /** @param {readonly any[]} list */
  const stopped = (list) => list.map((route) => ({ ...route, running: false }));

  return /** @type {import("@dusk-network/networks").Network} */ ({
    ...net,
    routes: {
      ...net.routes,
      migrations: stopped(net.routes.migrations),
      services: stopped(net.routes.services),
    },
  });
}
