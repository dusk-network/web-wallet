/**
 * What a stake or an unstake with Sozu did in stDUSK, from the facts the
 * export reads (`sozuFacts` of `@dusk-network/app-core/sozu`): the stDUSK it
 * got or gave back, to the lux, and what one stDUSK was worth then.
 */

import { formatDuskExact } from "$lib/dusk/currency";

/** A lux of DUSK, in DUSK: one stDUSK's worth is counted to it. */
const LUX_PER_DUSK = 1_000_000_000n;

/**
 * The lines the details and the Sent screen give a stake's or an unstake's
 * stDUSK in: what moved, hidden with the balances, and the rate, which says
 * nothing of what's held.
 *
 * @param {import("@dusk-network/app-core/sozu").SozuFact} fact
 * @param {string} locale
 * @returns {{ hidden: boolean, term: string, unit: string, value: string }[]}
 */
export const stDuskLines = (fact, locale) => [
  {
    hidden: true,
    term: fact.kind === "stake" ? "You got" : "You gave back",
    unit: "stDUSK",
    value: formatDuskExact(fact.stDusk, locale),
  },
  ...(fact.pool.supply > 0n
    ? [
        {
          hidden: false,
          term: "Rate",
          unit: "DUSK",
          value: `1 stDUSK = ${formatDuskExact((LUX_PER_DUSK * fact.pool.stake) / fact.pool.supply, locale)}`,
        },
      ]
    : []),
];
