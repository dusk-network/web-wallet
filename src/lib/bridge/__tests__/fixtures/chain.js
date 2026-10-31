/**
 * Another chain for a test, as `@dusk-network/app-core/bridge` reads it:
 * its JSON-RPC, and the logs a transfer's credit is among.
 */

/** @param {bigint | number} n */
const hex = (n) => `0x${BigInt(n).toString(16)}`;

/**
 * An address as an indexed log topic: 32 bytes, lower case.
 *
 * @param {string} address
 */
export const topicOf = (address) =>
  `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

/**
 * A 32-byte word of a log's data.
 *
 * @param {bigint} n
 */
export const wordOf = (n) => n.toString(16).padStart(64, "0");

/**
 * @typedef {{ address: string, block: bigint, data: string, hash: string, topics: string[] }} ChainLog
 *
 * @typedef {{ blockMs: number, head: bigint, headAt: number, logs: ChainLog[], url: string }} Chain
 *   `head` its newest block, made at `headAt`, each block `blockMs` after
 *   the one before
 */

/**
 * A chain's JSON-RPC at `chain.url`, as `chain` is when it's asked, which
 * gives `eth_getLogs` as the chain does: of the contract asked, in the
 * blocks asked, with the topics asked. `asked` keeps each request.
 *
 * @param {Chain} chain
 */
export function fakeChain(chain) {
  /** @type {{ method: string, params: any[] }[]} */
  const asked = [];
  /** @param {bigint} n */
  const timeOf = (n) =>
    Math.floor((chain.headAt - Number(chain.head - n) * chain.blockMs) / 1_000);

  /**
   * @param {string} method
   * @param {any[]} params
   */
  const answer = (method, params) => {
    if (method === "eth_blockNumber") {
      return hex(chain.head);
    }

    if (method === "eth_getBlockByNumber") {
      const n = params[0] === "latest" ? chain.head : BigInt(params[0]);

      return { number: hex(n), timestamp: hex(timeOf(n)) };
    }

    const [{ address, fromBlock, toBlock, topics }] = params;

    return chain.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === address &&
          log.block >= BigInt(fromBlock) &&
          log.block <= BigInt(toBlock) &&
          topics.every(
            (/** @type {string | null} */ topic, /** @type {number} */ i) =>
              topic === null || topic === log.topics[i]
          )
      )
      .map((log) => ({
        address: log.address,
        blockNumber: hex(log.block),
        data: log.data,
        topics: log.topics,
        transactionHash: log.hash,
      }));
  };

  return {
    /**
     * @param {RequestInfo | URL} to
     * @param {RequestInit} [init]
     */
    async answer(to, init) {
      if (String(to) !== chain.url) {
        throw new Error(`Nothing answers at ${to}`);
      }

      const { id, method, params } = JSON.parse(String(init?.body));

      asked.push({ method, params });

      return new Response(
        JSON.stringify({ id, jsonrpc: "2.0", result: answer(method, params) })
      );
    },

    asked,

    chain,

    /** The methods asked, in order. */
    methods: () => asked.map(({ method }) => method),
  };
}
