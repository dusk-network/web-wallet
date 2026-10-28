/**
 * A Testnet archive node for tests, answering from the recorded history in
 * activity-testnet.json the way the node does. Test-only.
 */

import { expect, vi } from "vitest";

import fixture from "./activity-testnet.json";

/**
 * The archive's `moonlightHistory` paging: heights up to toBlock, from the
 * first at fromBlock or above, then `maxCount` from page `pageCount`, oldest
 * first; null when empty.
 *
 * @param {any[]} list
 * @param {{ fromBlock?: number, maxCount?: number, pageCount?: number, toBlock?: number }} args
 */
export function page(
  list,
  { fromBlock = 0, maxCount, pageCount = 1, toBlock }
) {
  let items = list.filter(
    (e) => toBlock === undefined || e.block_height <= toBlock
  );
  const lower = items.findIndex((e) => e.block_height >= fromBlock);

  items = lower < 0 ? [] : items.slice(lower);

  if (maxCount !== undefined) {
    items = items.slice((pageCount - 1) * maxCount, pageCount * maxCount);
  }

  return items.length ? { json: items } : null;
}

/**
 * Answers one query as the node would.
 *
 * @param {any} node
 * @param {string} query
 * @param {Record<string, any>} accounts
 */
function answer(node, query, accounts) {
  /** @type {Record<string, any>} */
  const data = {};

  if (query.includes("pair: lastBlockPair { json }")) {
    data.pair = {
      json: {
        // eslint-disable-next-line camelcase
        last_block: [node.finalized + 1, "aa"],
        // eslint-disable-next-line camelcase
        last_finalized_block: [node.finalized, "bb"],
      },
    };
  }

  if (query.includes("genesis: block(height: 0) { header { hash } }")) {
    data.genesis = { header: { hash: node.genesis } };
  }

  for (const m of query.matchAll(
    /(\w+): moonlightHistory\((sender|receiver): "([^"]+)"((?:, \w+: \d+)*)\) \{ json \}/g
  )) {
    const args = Object.fromEntries(
      [...m[4].matchAll(/(\w+): (\d+)/g)].map(([, k, v]) => [k, Number(v)])
    );

    // The archive has finalized blocks only.
    const list = (accounts[m[3]]?.[m[2]] ?? []).filter(
      (/** @type {any} */ e) => e.block_height <= node.finalized
    );

    data[m[1]] = page(list, args);
  }

  for (const m of query.matchAll(/(t\d+): tx\(hash: "([0-9a-f]{64})"\)/g)) {
    data[m[1]] =
      /** @type {Record<string, any>} */ (fixture.details)[m[2]] ?? null;
  }

  return data;
}

/**
 * Stub `fetch` with a node holding the recorded history. Change `finalized`
 * (its last finalized block), `genesis`, `down` (every request fails),
 * `archive` (false: a node without the archive's fields) or `before`
 * (awaited with each query before its answer) as a test goes; `log` keeps
 * each query and its answer.
 *
 * @param {{ accounts?: Record<string, any>, finalized?: number, genesis?: string }} [options]
 */
export function fakeArchive({
  accounts = fixture.accounts,
  finalized = Number(fixture.head.last_finalized_block[0]),
  genesis = fixture.head.genesis,
} = {}) {
  const node = {
    archive: true,
    /** @type {((query: string) => Promise<void>) | null} */
    before: null,
    detailQueries: () => node.log.filter((l) => l.query.includes("tx(hash:")),
    down: false,
    finalized: Number(finalized),
    genesis: String(genesis),
    historyQueries: () =>
      node.log.filter((l) => l.query.includes("moonlightHistory")),
    /** @type {{ data: any, query: string }[]} */
    log: [],
  };
  const fetchMock = vi.fn(async (url, init) => {
    expect(String(url)).toBe(`${fixture.nodeUrl}/on/graphql/query`);

    if (node.down) {
      throw new TypeError("fetch failed");
    }

    const query = String(init.body);

    await node.before?.(query);

    // async-graphql refuses a whole query with a field the schema lacks.
    const missing = query.match(/\b(moonlightHistory|contractEvents)\(/);

    if (!node.archive && missing) {
      const errors = [
        {
          locations: [{ column: 9, line: 1 }],
          message: `Unknown field "${missing[1]}" on type "Query".`,
        },
      ];

      node.log.push({ data: null, query });

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: null, errors }),
      };
    }

    const data = answer(node, query, accounts);

    node.log.push({ data, query });

    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  });

  vi.stubGlobal("fetch", fetchMock);

  return node;
}
