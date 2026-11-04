/**
 * Looks for the payouts of the transfers under way for as long as a screen
 * that shows them is open: as soon as one is under way, then on a timer while
 * the page is shown. A stuck transfer costs no reads once it's closed.
 */

import { get } from "svelte/store";

import { transferArrivals } from "./migrationActivity";
import { routeTransfers } from "./routeHistory";
import { followTransfers, toFollow } from "./routeTracking";

/** How often it looks while a transfer is under way. */
const FOLLOW_MS = 30_000;

/** @returns {() => void} Stops */
export function followRouteTransfers() {
  let following = false;
  let underWay = "";

  async function follow() {
    if (following) {
      return;
    }

    following = true;

    try {
      await followTransfers(get(routeTransfers), get(transferArrivals));
    } finally {
      following = false;
    }
  }

  const stopWatching = routeTransfers.subscribe((transfers) => {
    const now = toFollow(transfers)
      .map(({ hash }) => hash)
      .join(" ");

    if (now && now !== underWay) {
      void follow();
    }

    underWay = now;
  });
  const timer = setInterval(() => {
    if (document.visibilityState !== "hidden") {
      void follow();
    }
  }, FOLLOW_MS);

  return () => {
    stopWatching();
    clearInterval(timer);
  };
}
