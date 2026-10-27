/**
 * What the chains say about how long DuskEVM's routes take, kept per
 * network: read when a page asks, at most every 10 minutes, and kept in this
 * browser for a day, so a page shows it at once on the next visit.
 */

const L1_BLOCK = "0x4200000000000000000000000000000000000015";

/** `number()` on DuskEVM's L1Block predeploy: the Dusk block it last took in. */
const L1_BLOCK_NUMBER = "0x8381f58a";

const TTL_MS = 10 * 60_000;
const MAX_AGE_MS = 86_400_000;

/**
 * How far DuskEVM trails Dusk, in seconds: from Dusk's time for the block
 * DuskEVM last took in, to DuskEVM's latest block. A deposit arrives about
 * this long after its Dusk block. The time DuskEVM itself keeps for that
 * block runs behind Dusk's, so Dusk's own is read.
 *
 * @param {{
 *   blockTime: (height: bigint) => Promise<bigint | number | string | null | undefined>,
 *   l2Batch: (calls: { method: string, params: unknown[] }[]) => Promise<any[]>,
 * }} deps
 * @returns {Promise<number>}
 */
export async function readDepositLag({ blockTime, l2Batch }) {
  const [head, origin] = await l2Batch([
    { method: "eth_getBlockByNumber", params: ["latest", false] },
    {
      method: "eth_call",
      params: [{ data: L1_BLOCK_NUMBER, to: L1_BLOCK }, "latest"],
    },
  ]);

  if (!head?.timestamp || !origin || origin === "0x") {
    throw new Error("DuskEVM didn't say which Dusk block it's on.");
  }

  const at = await blockTime(BigInt(origin));

  if (at === undefined || at === null) {
    throw new Error("Dusk didn't give that block's time.");
  }

  return Math.max(0, Number(BigInt(head.timestamp)) - Number(at));
}

/**
 * @param {{
 *   key: string,
 *   now?: () => number,
 *   read: {
 *     deposit: () => Promise<number>,
 *     withdrawal: () => Promise<Omit<NonNullable<ChainTimes["withdrawal"]>, "at">>,
 *   },
 *   storage?: Storage | null,
 *   ttlMs?: number,
 * }} deps
 */
export function createChainTimes({
  key,
  now = Date.now,
  read,
  storage = globalThis.localStorage ?? null,
  ttlMs = TTL_MS,
}) {
  /** @type {ChainTimes} */
  let kept = {};

  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? "null");

    if (parsed && typeof parsed === "object") {
      kept = parsed;
    }
  } catch {
    // Read again from the chains.
  }

  /** @type {Promise<boolean> | null} */
  let running = null;

  /**
   * @param {{ at?: number } | undefined} part
   * @param {number} age
   */
  const fresh = (part, age) =>
    Boolean(part?.at) && now() - Number(part?.at) < age;

  /**
   * What the chains said, each part at most a day old; null when nothing is
   * known.
   *
   * @returns {ChainTimes | null}
   */
  function get() {
    const parts = Object.entries(kept).filter(([, part]) =>
      fresh(part, MAX_AGE_MS)
    );

    return parts.length ? Object.fromEntries(parts) : null;
  }

  async function load() {
    const names = /** @type {("deposit" | "withdrawal")[]} */ (
      Object.keys(read)
    ).filter((name) => !fresh(kept[name], ttlMs));

    if (!names.length) {
      return false;
    }

    const answers = await Promise.allSettled(names.map((name) => read[name]()));
    /** @type {ChainTimes} */
    const next = { ...kept };
    let changed = false;

    names.forEach((name, index) => {
      const answer = answers[index];

      // A part that couldn't be read keeps what was read before.
      if (answer.status !== "fulfilled" || answer.value === null) {
        return;
      }

      const value =
        name === "deposit"
          ? { lagSeconds: /** @type {number} */ (answer.value) }
          : /** @type {object} */ (answer.value);
      // What was read before, without when.
      const before = { ...kept[name], at: undefined };

      if (JSON.stringify(before) !== JSON.stringify(value)) {
        changed = true;
      }

      next[name] = /** @type {any} */ ({ ...value, at: now() });
    });

    kept = next;

    try {
      storage?.setItem(key, JSON.stringify(kept));
    } catch {
      // Kept for this visit only.
    }

    return changed;
  }

  /**
   * Reads what's older than 10 minutes; whether anything shown changed.
   *
   * @returns {Promise<boolean>}
   */
  function refresh() {
    running ??= load().finally(() => {
      running = null;
    });

    return running;
  }

  return Object.freeze({ get, refresh });
}
