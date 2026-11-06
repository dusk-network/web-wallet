/**
 * How Sozu's stDUSK grew lately, as app-core reads it from the chain: the
 * pool's restakes about 30 days apart, after Sozu's share. One read for each
 * place Sozu's rate shows, kept an hour.
 */

import { sozuGrowth } from "@dusk-network/app-core/sozu";

import { archiveAt } from "$lib/activity/activityHistory";

/** What's read, kept by app-core for an hour, as text. */
const cache = new Map();

/**
 * How Sozu's stDUSK grew over the last 30 days, for the status read: null
 * where it can't be read, or doesn't agree with the pool's rate now.
 *
 * @param {{ nodeUrl: string, status: SozuStatus | null, tipHeight?: bigint | null }} options
 * @returns {Promise<import("@dusk-network/app-core/sozu").SozuGrowth | null>}
 */
export function readSozuGrowth({ nodeUrl, status, tipHeight }) {
  const pool = status?.contracts.pool;

  return pool
    ? sozuGrowth({
        archive: archiveAt(nodeUrl),
        cache,
        pool,
        status,
        tipHeight,
      }).catch(() => null)
    : Promise.resolve(null);
}
