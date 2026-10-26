import { networkStore } from "$lib/stores";

/** How often the node is asked about the transaction, in milliseconds. */
export const FOLLOW_INTERVAL = 4_000;

/** How long a transaction is followed, in milliseconds: three minutes. */
export const FOLLOW_TIMEOUT = 180_000;

/**
 * @typedef {{
 *   blockHeight: bigint,
 *   error: string | null,
 *   fee: bigint,
 * }} FinalTransaction
 */

/**
 * The transaction's outcome once the block it is in is final, or `null`
 * while it isn't in a final block yet.
 *
 * @param {Network} network
 * @param {string} hash
 * @param {AbortSignal} signal Cancels the queries.
 * @returns {Promise<FinalTransaction | null>}
 */
async function getFinalTransaction(network, hash, signal) {
  const { tx } = await network.query(
    `tx(hash: "${hash}") { blockHash blockHeight err gasSpent tx { gasPrice } }`,
    { signal }
  );

  if (!tx) {
    return null;
  }

  const { block } = await network.query(
    `block(hash: "${tx.blockHash}") { status }`,
    { signal }
  );

  if (!Object.hasOwn(block?.status ?? {}, "Final")) {
    return null;
  }

  return {
    blockHeight: BigInt(tx.blockHeight),
    error: tx.err || null,
    fee: BigInt(tx.gasSpent) * BigInt(tx.tx.gasPrice),
  };
}

/**
 * One check, which gives up with `null` once the deadline passes or the
 * signal aborts, and cancels its queries: a node that doesn't answer never
 * holds the follow past its end. A check that fails gives `null` too.
 *
 * @param {Network} network
 * @param {string} hash
 * @param {{ deadline: number, signal: AbortSignal }} options
 * @returns {Promise<FinalTransaction | null>}
 */
function checkBefore(network, hash, { deadline, signal }) {
  const check = new AbortController();
  const stop = () => check.abort();
  const timer = window.setTimeout(stop, deadline - Date.now());

  signal.addEventListener("abort", stop, { once: true });

  /** @type {Promise<FinalTransaction | null>} */
  const outcome = new Promise((resolve) => {
    check.signal.addEventListener("abort", () => resolve(null), {
      once: true,
    });
    getFinalTransaction(network, hash, check.signal).then(resolve, () =>
      resolve(null)
    );
  });

  return outcome.finally(() => {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  });
}

/**
 * Pauses between checks, which a wake ends at once. A wake between two
 * pauses ends the next one, so that none is missed.
 */
function createPauses() {
  let isWoken = false;

  /** @type {() => void} */
  let end = () => {};

  return {
    /** @param {number} milliseconds */
    async pause(milliseconds) {
      if (!isWoken) {
        await new Promise((resolve) => {
          const timer = window.setTimeout(resolve, milliseconds);

          end = () => {
            window.clearTimeout(timer);
            resolve(undefined);
          };
        });
      }

      isWoken = false;
      end = () => {};
    },

    wake() {
      isWoken = true;
      end();
    },
  };
}

/**
 * Listens for the node's event saying a block took the transaction.
 *
 * @param {Network} network
 * @param {string} hash
 * @param {AbortSignal} signal Ends the subscription.
 * @param {() => void} onExecuted
 */
function listenForExecution(network, hash, signal, onExecuted) {
  try {
    network.transactions
      .withId(hash)
      .once.executed({ signal })
      .then(onExecuted, () => {});
  } catch {
    // Without the event, the checks alone follow the transaction.
  }
}

/**
 * Checks the transaction after each pause until it is in a final block,
 * the deadline passes or the signal aborts.
 *
 * @param {Network} network
 * @param {string} hash
 * @param {{
 *   deadline: number,
 *   interval: number,
 *   pauses: ReturnType<typeof createPauses>,
 *   signal: AbortSignal,
 * }} options
 * @returns {Promise<FinalTransaction | null>}
 */
async function checkUntilFinal(
  network,
  hash,
  { deadline, interval, pauses, signal }
) {
  while (!signal.aborted && Date.now() < deadline) {
    await pauses.pause(Math.min(interval, deadline - Date.now()));

    // The pause can end at the deadline, or because the signal aborted.
    if (signal.aborted || Date.now() >= deadline) {
      break;
    }

    const final = await checkBefore(network, hash, { deadline, signal });

    if (final) {
      return final;
    }
  }

  return null;
}

/**
 * Follows a transaction the wallet sent until the block it is in is final.
 * The node's event for the transaction says when a block takes it, and
 * checks every few seconds catch an event that was missed.
 *
 * Resolves with the transaction's outcome and the fee it was charged, or
 * with `null` if its block isn't final before the timeout, or once the
 * signal aborts. A check that fails is made again at the next one.
 *
 * @param {string} hash
 * @param {{ interval?: number, signal?: AbortSignal, timeout?: number }} [options]
 * @returns {Promise<FinalTransaction | null>}
 */
export default async function followTransaction(
  hash,
  { interval = FOLLOW_INTERVAL, signal, timeout = FOLLOW_TIMEOUT } = {}
) {
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("Invalid transaction hash");
  }

  const deadline = Date.now() + timeout;
  const network = await networkStore.connect();
  const pauses = createPauses();

  // Ends the event subscription and the checks when following stops.
  const following = new AbortController();
  const until = signal
    ? AbortSignal.any([signal, following.signal])
    : following.signal;

  until.addEventListener("abort", pauses.wake, { once: true });
  listenForExecution(network, hash, until, pauses.wake);

  try {
    return await checkUntilFinal(network, hash, {
      deadline,
      interval,
      pauses,
      signal: until,
    });
  } finally {
    following.abort();
  }
}
