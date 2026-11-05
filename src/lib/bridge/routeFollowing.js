/**
 * Looks for the payouts of the transfers under way for as long as a screen
 * that shows them is open: as soon as one is under way, then on a timer while
 * the page is shown. A stuck transfer costs no reads once it's closed.
 */

import { get } from "svelte/store";

import { followsWhileAway } from "./arrivalNotice";
import { transferArrivals } from "./migrationActivity";
import { FOLLOW_FOR_MS, routeTransfers } from "./routeHistory";
import { followTransfers, toFollow } from "./routeTracking";

/** How often it looks while a transfer is under way. */
const FOLLOW_MS = 15_000;

/**
 * @param {{ recentOnly?: boolean }} [options] `recentOnly`: only while one sent
 *   in the last day is under way
 * @returns {() => void} Stops
 */
export function followRouteTransfers({ recentOnly = false } = {}) {
  let following = false;
  let underWay = "";

  async function follow() {
    if (following) {
      return;
    }

    const transfers = get(routeTransfers);

    if (
      recentOnly &&
      !toFollow(transfers).some(
        ({ at }) => Date.now() - (at ?? 0) < FOLLOW_FOR_MS
      )
    ) {
      return;
    }

    following = true;

    try {
      await followTransfers(transfers, get(transferArrivals));
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
    if (document.visibilityState !== "hidden" || followsWhileAway()) {
      void follow();
    }
  }, FOLLOW_MS);

  return () => {
    stopWatching();
    clearInterval(timer);
  };
}
