/**
 * What each migration into Dusk did on its own chain, as app-core reads it
 * from the route's RPC: its gas with the approval it spent, wherever and
 * whenever that was signed, for a transfer's details and the accountant's
 * file. What's final is read once.
 */

import { migrationFacts } from "@dusk-network/app-core/bridge";

/** What's final, kept as app-core writes it. */
const cache = new Map();

/**
 * Each migration's side on its own chain, by its hash in lower case: none
 * where its chain can't be read.
 *
 * @param {import("@dusk-network/networks").Network} network
 * @param {Iterable<{ approval?: string | null, hash: string, route?: string | null }>} migrations
 * @returns {Promise<Map<string, import("@dusk-network/app-core/bridge").MigrationEvm>>}
 */
export const readMigrationsEvm = (network, migrations) =>
  migrationFacts({ cache, migrations, network }).catch(() => new Map());
