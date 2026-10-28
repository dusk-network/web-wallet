/**
 * Contract reads sent through Multicall for Dusk: a fetch for the Dusk Domains
 * lens reader that puts the reads it makes in one task (`POST
 * <node>/on/contracts:<id>/<fn>`) into one `aggregate` query, at most
 * MAX_BATCH of them, and answers each read with its own result, as the node
 * would have. The reader decodes and checks every reply as before; only the
 * transport changes.
 *
 * As the SDK's own batcher (src/frozen/batching.ts in @duskdomains/sdk 0.5.4,
 * MIT), which its full client uses: a read that ran out of its share of gas
 * is sent alone, a query that failed whole sends its reads alone (two in a
 * row turn batching off for 5 minutes), and a rate limit (a 429, or a 503
 * that says when to come back) is every read's answer. A query is cancelled
 * once every read in it gave up.
 */

import {
  ARGBUF_LEN,
  MAX_CALLS,
  MULTICALL_CONTRACT_ID,
  callBytes,
  decodeAggregate,
  encodeAggregate,
  envelopeLength,
  replyLength,
} from "$lib/vendor/duskdomains-multicall";

export { MULTICALL_CONTRACT_ID };

/**
 * Reads one aggregate carries. On Testnet, 60 verified primary names (842M gas
 * cap each) passed in one; 32 stays well under the node's 3e9 query gas bound
 * and the 64 KiB reply.
 */
export const MAX_BATCH = 32;

/** Reply bytes a query is planned for, below the multicall's 65,536. */
const REPLY_BUDGET = 60_000;

/** A read's reply estimate before one was seen. */
const FIRST_REPLY = 2048;

const STREAK = 2;
const HOLDOFF_MS = 300_000;

/**
 * @typedef {{
 *   init: RequestInit,
 *   reject: (reason?: unknown) => void,
 *   resolve: (response: Response) => void,
 * }} MulticallWaiter
 *
 * @typedef {{
 *   args: Uint8Array,
 *   fn: string,
 *   gas: bigint,
 *   id: string,
 *   input: RequestInfo | URL,
 *   waiters: MulticallWaiter[],
 * }} MulticallCall
 *
 * @typedef {{ Ok: Uint8Array } | { Err: "OutOfGas" | "DoesNotExist" | "Unknown" | { Panic: string } }} MulticallResult
 */

/**
 * The next task, after this one's microtasks, without the throttling a
 * background tab puts on timers.
 *
 * @param {() => void} task
 */
function nextTask(task) {
  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();

    channel.port1.onmessage = () => {
      channel.port1.close();
      task();
    };
    channel.port2.postMessage(null);

    return;
  }

  setTimeout(task, 0);
}

/** @param {string} hex */
const hexToBytes = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {Uint8Array} bytes */
const bytesToHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * @param {BodyInit | null | undefined} body
 * @returns {Uint8Array | null}
 */
function bodyBytes(body) {
  if (body instanceof Uint8Array) {
    return new Uint8Array(body);
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body.slice(0));
  }

  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  }

  return null;
}

/** @param {Uint8Array} bytes */
const ok = (bytes) =>
  new Response(bytes.slice(), {
    headers: { "Content-Type": "application/octet-stream" },
    status: 200,
  });

/**
 * Whether a reply is the node limiting its rate, as the SDK's readers take
 * it: a 429, or a 503 that says when to come back, in seconds or as an HTTP
 * date. Any other 503 is a failed query.
 *
 * @param {Response} res
 */
function isRateLimit(res) {
  if (res.status !== 503) {
    return res.status === 429;
  }

  const wait = res.headers.get("Retry-After")?.trim() ?? "";

  return (
    /^\d+$/.test(wait) ||
    (Number.isFinite(Date.parse(wait)) && /[a-z]/i.test(wait))
  );
}

/**
 * A rate limit is the node's answer to every read in the query: each gets
 * its wait, and the node's Date, which a wait given as a date counts from.
 * Without it the reader counts from this clock instead.
 *
 * @param {MulticallCall[]} batch
 * @param {Response} res
 */
function answerRateLimited(batch, res) {
  /** @type {Record<string, string>} */
  const headers = { "Retry-After": res.headers.get("Retry-After") ?? "" };
  const date = res.headers.get("Date");

  if (date) {
    headers.Date = date;
  }

  for (const waiter of batch.flatMap((call) => call.waiters)) {
    waiter.resolve(
      new Response("Rate limited", { headers, status: res.status })
    );
  }
}

/**
 * A signal for a request several waiters share: it aborts once each of their
 * own signals has, as nobody waits for the answer then. A waiter without a
 * signal keeps the request. `release` stops listening to theirs.
 *
 * @param {MulticallWaiter[]} waiters
 */
function whileAnyWaits(waiters) {
  const controller = new AbortController();
  const signals = waiters.map(({ init }) => init?.signal);

  if (signals.some((signal) => !signal)) {
    return { release: () => {}, signal: controller.signal };
  }

  const waiting = new Set(/** @type {AbortSignal[]} */ (signals));
  const onAbort = () => {
    for (const signal of waiting) {
      if (signal.aborted) {
        waiting.delete(signal);
      }
    }

    if (!waiting.size) {
      controller.abort();
    }
  };

  for (const signal of waiting) {
    signal.addEventListener("abort", onAbort);
  }

  onAbort();

  return {
    release: () => {
      for (const signal of /** @type {AbortSignal[]} */ (signals)) {
        signal.removeEventListener("abort", onAbort);
      }
    },
    signal: controller.signal,
  };
}

/**
 * The batch's `aggregate` envelope, or null when it can't be made.
 *
 * @param {MulticallCall[]} batch
 * @returns {Uint8Array | null}
 */
function encodeBatch(batch) {
  try {
    return encodeAggregate(
      batch.map((call) => ({
        args: call.args,
        contract: hexToBytes(call.id),
        fnName: call.fn,
        gasLimit: call.gas,
      }))
    );
  } catch {
    return null;
  }
}

/**
 * Whether one more read fits a batch: under the call limit, the envelope's
 * bytes and the reply's budget.
 *
 * @param {{ calls: MulticallCall[], data: number, reply: number }} batch
 * @param {number} own The read's envelope bytes
 * @param {number} estimate Its reply's expected bytes
 * @param {number} limit
 */
const fits = (batch, own, estimate, limit) =>
  batch.calls.length < limit &&
  envelopeLength(batch.calls.length + 1, batch.data + own) <= ARGBUF_LEN &&
  replyLength(batch.calls.length + 1, batch.reply + estimate) <= REPLY_BUDGET;

/**
 * The queued reads in batches that fit the multicall's bounds.
 *
 * @param {MulticallCall[]} calls
 * @param {Map<string, number>} sizes The largest reply seen per read
 * @param {number} maxBatch
 * @returns {MulticallCall[][]}
 */
function planBatches(calls, sizes, maxBatch) {
  const limit = Math.min(maxBatch, MAX_CALLS);

  /** @type {{ calls: MulticallCall[], data: number, reply: number }[]} */
  const batches = [];

  for (const call of calls) {
    const own = callBytes(call.fn, call.args);
    const estimate = sizes.get(`${call.id}/${call.fn}`) ?? FIRST_REPLY;
    let current = batches.at(-1);

    if (!current || !fits(current, own, estimate, limit)) {
      current = { calls: [], data: 0, reply: 0 };
      batches.push(current);
    }

    current.calls.push(call);
    current.data += own;
    current.reply += estimate;
  }

  return batches.map((batch) => batch.calls);
}

class MulticallBatcher {
  /** @type {typeof fetch} */
  #base;

  /** @type {(contractId: string, fnName: string) => bigint} */
  #gasFor;

  #maxBatch;

  #offUntil = -Infinity;

  /** @type {Map<string, MulticallCall>} */
  #pending = new Map();

  #prefix;

  /** @type {MulticallCall[]} */
  #queue = [];

  #scheduled = false;

  /** @type {Map<string, number>} */
  #sizes = new Map();

  #streak = 0;

  /**
   * @param {{
   *   base: typeof fetch,
   *   gasFor: (contractId: string, fnName: string) => bigint,
   *   maxBatch: number,
   *   nodeUrl: string,
   * }} options
   */
  constructor({ base, gasFor, maxBatch, nodeUrl }) {
    this.#base = base;
    this.#gasFor = gasFor;
    this.#maxBatch = maxBatch;
    this.#prefix = `${String(nodeUrl).replace(/\/$/, "")}/on/contracts:`;
  }

  /**
   * One read sent on its own, its answer given to every waiter; cancelled
   * once they all gave up.
   *
   * @param {MulticallCall} call
   */
  #alone(call) {
    const watch = whileAnyWaits(call.waiters);
    const last = call.waiters.length - 1;

    this.#base(call.input, { ...call.waiters[0].init, signal: watch.signal })
      .then(
        (res) => {
          call.waiters.forEach((waiter, i) =>
            waiter.resolve(i === last ? res : res.clone())
          );
        },
        (error) => {
          for (const waiter of call.waiters) {
            waiter.reject(error);
          }
        }
      )
      .finally(watch.release);
  }

  /**
   * Gives each read of a decoded query its own result.
   *
   * @param {MulticallCall} call
   * @param {MulticallResult} result
   */
  #answer(call, result) {
    if ("Ok" in result) {
      const key = `${call.id}/${call.fn}`;

      if (result.Ok.length > (this.#sizes.get(key) ?? 0)) {
        this.#sizes.set(key, result.Ok.length);
      }

      for (const waiter of call.waiters) {
        waiter.resolve(ok(result.Ok));
      }

      return;
    }

    // Its share of the query's gas was short: a query of its own has it all.
    if (result.Err === "OutOfGas") {
      this.#alone(call);

      return;
    }

    const message =
      typeof result.Err === "string" ? result.Err : result.Err.Panic;

    for (const waiter of call.waiters) {
      waiter.resolve(new Response(message, { status: 500 }));
    }
  }

  /**
   * One more query that failed sends its reads alone.
   *
   * @param {MulticallCall[]} batch
   */
  #failed(batch) {
    this.#strike();

    for (const call of batch) {
      this.#alone(call);
    }
  }

  #flush() {
    const calls = this.#queue;

    this.#scheduled = false;
    this.#queue = [];
    this.#pending = new Map();

    for (const batch of planBatches(calls, this.#sizes, this.#maxBatch)) {
      void this.#send(batch);
    }
  }

  /**
   * The batch as one `aggregate` query: its decoded results, or null when
   * the batch was answered otherwise.
   *
   * @param {MulticallCall[]} batch
   * @param {Uint8Array} envelope
   * @returns {Promise<{ results: MulticallResult[] } | null>}
   */
  async #query(batch, envelope) {
    // Cancelled once every read in it gave up waiting, so hung queries don't pile up.
    const watch = whileAnyWaits(batch.flatMap((call) => call.waiters));

    try {
      const res = await this.#base(
        `${this.#prefix}${MULTICALL_CONTRACT_ID}/aggregate`,
        {
          body: /** @type {BodyInit} */ (envelope),
          headers: {
            Accept: "application/octet-stream",
            "Content-Type": "application/octet-stream",
          },
          method: "POST",
          signal: watch.signal,
        }
      );

      if (isRateLimit(res)) {
        answerRateLimited(batch, res);

        return null;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return /** @type {{ results: MulticallResult[] }} */ (
        decodeAggregate(new Uint8Array(await res.arrayBuffer()), batch.length)
      );
    } catch {
      // Nobody waits for the reads of a query they all gave up on: they aren't sent again.
      if (watch.signal.aborted) {
        this.#strike();
      } else {
        this.#failed(batch);
      }

      return null;
    } finally {
      watch.release();
    }
  }

  /** @param {MulticallCall[]} batch */
  async #send(batch) {
    // A batch of one gains nothing from the multicall.
    if (batch.length === 1) {
      this.#alone(batch[0]);

      return;
    }

    const envelope = encodeBatch(batch);

    if (!envelope) {
      this.#failed(batch);

      return;
    }

    const decoded = await this.#query(batch, envelope);

    if (decoded) {
      this.#streak = 0;
      batch.forEach((call, i) => this.#answer(call, decoded.results[i]));
    }
  }

  /** Two failed queries in a row turn batching off for a while. */
  #strike() {
    this.#streak += 1;

    if (this.#streak >= STREAK) {
      this.#offUntil = Date.now() + HOLDOFF_MS;
      this.#streak = 0;
    }
  }

  /**
   * Whether a request is a contract read this batcher takes: its contract
   * and function, or null.
   *
   * @param {RequestInfo | URL} input
   * @param {RequestInit} init
   * @returns {{ args: Uint8Array, fn: string, id: string } | null}
   */
  #readOf(input, init) {
    const url = String(
      /** @type {any} */ (input)?.href ??
        /** @type {any} */ (input)?.url ??
        input
    );
    const match = url.startsWith(this.#prefix)
      ? /^([0-9a-f]{64})\/([A-Za-z0-9_]+)$/.exec(url.slice(this.#prefix.length))
      : null;
    const args = match ? bodyBytes(init.body) : null;

    if (
      !match ||
      !args ||
      match[1] === MULTICALL_CONTRACT_ID ||
      String(init.method).toUpperCase() !== "POST" ||
      Date.now() < this.#offUntil
    ) {
      return null;
    }

    return { args, fn: match[2], id: match[1] };
  }

  /**
   * @param {RequestInfo | URL} input
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  fetch(input, init = {}) {
    const read = this.#readOf(input, init);

    if (!read) {
      return this.#base(input, init);
    }

    return new Promise((resolve, reject) => {
      const signal = init.signal;

      if (signal?.aborted) {
        reject(signal.reason);

        return;
      }

      signal?.addEventListener?.("abort", () => reject(signal.reason), {
        once: true,
      });

      const key = `${read.id}/${read.fn}/${bytesToHex(read.args)}`;
      let call = this.#pending.get(key);

      // The same read twice in one task is one call.
      if (!call) {
        call = {
          ...read,
          gas: this.#gasFor(read.id, read.fn),
          input,
          waiters: [],
        };
        this.#pending.set(key, call);
        this.#queue.push(call);
      }

      call.waiters.push({ init, reject, resolve });

      if (!this.#scheduled) {
        this.#scheduled = true;
        nextTask(() => this.#flush());
      }
    });
  }
}

/**
 * @param {{
 *   fetch?: typeof fetch,
 *   gasFor?: (contractId: string, fnName: string) => bigint,
 *   maxBatch?: number,
 *   nodeUrl: string,
 * }} options `fetch` sends everything else and the aggregates; `gasFor` is a
 *   read's gas cap inside an aggregate, 0n for a fair share of the query's.
 * @returns {typeof fetch}
 */
export function createMulticallFetch({
  fetch: base = (...args) => fetch(...args),
  gasFor = () => 0n,
  maxBatch = MAX_BATCH,
  nodeUrl,
}) {
  const batcher = new MulticallBatcher({ base, gasFor, maxBatch, nodeUrl });

  return (input, init) => batcher.fetch(input, init);
}
