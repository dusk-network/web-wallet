import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOLLOW_INTERVAL, FOLLOW_TIMEOUT, followTransaction } from "..";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("$lib/stores", () => ({ networkStore: { connect } }));

const hash = "8dcf6f8a".padEnd(64, "0");
const blockHash = "bc5176b5".padEnd(64, "1");

/**
 * A transaction as the node's GraphQL returns it.
 *
 * @param {Record<string, any>} [fields]
 */
const spentTx = (fields = {}) => ({
  tx: {
    blockHash,
    blockHeight: 4_687_200,
    blockTimestamp: 1_793_166_840,
    err: null,
    gasSpent: 1_854_795,
    tx: { gasPrice: 1 },
    ...fields,
  },
});

/** @param {string} status */
const blockWith = (status) => ({ block: { status: { [status]: 1 } } });

/**
 * What the promise settled with, or "pending" if it hasn't.
 *
 * @param {Promise<any>} promise
 */
const settled = (promise) =>
  Promise.race([promise, Promise.resolve("pending")]);

/** A query that never answers. */
const unanswered = () => new Promise(() => {});

describe("followTransaction", () => {
  /** @type {PromiseWithResolvers<any>} */
  let executed;

  const query = vi.fn();
  const executedWatcher = vi.fn();
  const withId = vi.fn(() => ({ once: { executed: executedWatcher } }));

  beforeEach(() => {
    vi.useFakeTimers();

    executed = Promise.withResolvers();
    executedWatcher.mockImplementation(({ signal }) => {
      signal.addEventListener("abort", () => executed.reject(new Error()));
      return executed.promise;
    });
    query.mockReset();
    connect.mockResolvedValue({ query, transactions: { withId } });
  });

  afterEach(() => {
    vi.useRealTimers();
    connect.mockReset();
    executedWatcher.mockReset();
    withId.mockClear();
  });

  it("should resolve with the fee charged once the transaction's block is final", async () => {
    query
      .mockResolvedValueOnce({ tx: null })
      .mockResolvedValueOnce(spentTx())
      .mockResolvedValueOnce(blockWith("Attested"))
      .mockResolvedValueOnce(spentTx())
      .mockResolvedValueOnce(blockWith("Final"));

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL * 3);

    await expect(result).resolves.toStrictEqual({
      blockHeight: 4_687_200n,
      error: null,
      fee: 1_854_795n,
      // Its block's time.
      timestamp: 1_793_166_840_000,
    });
    expect(withId).toHaveBeenCalledWith(hash);
    expect(query).toHaveBeenCalledTimes(5);
    expect(query).toHaveBeenNthCalledWith(
      2,
      `tx(hash: "${hash}") { blockHash blockHeight blockTimestamp err gasSpent tx { gasPrice } }`,
      { signal: expect.any(AbortSignal) }
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      `block(hash: "${blockHash}") { status }`,
      { signal: expect.any(AbortSignal) }
    );
  });

  it("should give the error of a transaction that failed, with the fee it was charged", async () => {
    query
      .mockResolvedValueOnce(
        spentTx({ err: "Panic: out of gas", gasSpent: 2_500_000 })
      )
      .mockResolvedValueOnce(blockWith("Final"));

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL);

    await expect(result).resolves.toStrictEqual({
      blockHeight: 4_687_200n,
      error: "Panic: out of gas",
      fee: 2_500_000n,
      timestamp: 1_793_166_840_000,
    });
  });

  it("should give no time for a block the node gives none for", async () => {
    query
      .mockResolvedValueOnce(spentTx({ blockTimestamp: null }))
      .mockResolvedValueOnce(blockWith("Final"));

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL);

    await expect(result).resolves.toMatchObject({ timestamp: null });
  });

  it("should check right away when the node says a block took the transaction", async () => {
    query
      .mockResolvedValueOnce(spentTx({ tx: { gasPrice: 2 } }))
      .mockResolvedValueOnce(blockWith("Final"));

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(1);
    executed.resolve({});
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toStrictEqual({
      blockHeight: 4_687_200n,
      error: null,
      fee: 3_709_590n,
      timestamp: 1_793_166_840_000,
    });
  });

  it("should check again after a check fails", async () => {
    query
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(spentTx())
      .mockResolvedValueOnce(blockWith("Final"));

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL * 2);

    await expect(result).resolves.toMatchObject({ fee: 1_854_795n });
  });

  it("should still follow the transaction without the node's event", async () => {
    executedWatcher.mockImplementation(() => {
      throw new TypeError("No event");
    });
    query
      .mockResolvedValueOnce(spentTx())
      .mockResolvedValueOnce(blockWith("Final"));

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL);

    await expect(result).resolves.toMatchObject({ fee: 1_854_795n });
  });

  it("should resolve with `null`, and stop listening, if the block isn't final before the timeout", async () => {
    query.mockResolvedValue({ tx: null });

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_TIMEOUT);

    await expect(result).resolves.toBeNull();
    await expect(executed.promise).rejects.toThrow();

    const checks = query.mock.calls.length;

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL * 2);

    expect(query).toHaveBeenCalledTimes(checks);
  });

  it("should resolve with `null`, and stop checking, once the signal aborts", async () => {
    const controller = new AbortController();

    query.mockResolvedValue({ tx: null });

    const result = followTransaction(hash, { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL);
    controller.abort();

    await expect(result).resolves.toBeNull();
    await expect(executed.promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL * 2);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("should resolve with `null` at the timeout while a check never answers", async () => {
    query.mockImplementation(unanswered);

    const result = followTransaction(hash);

    await vi.advanceTimersByTimeAsync(FOLLOW_TIMEOUT);

    expect(await settled(result)).toBeNull();
    expect(query.mock.calls.at(-1)?.[1].signal.aborted).toBe(true);
  });

  it("should resolve with `null`, and cancel the check, once the signal aborts during one", async () => {
    const controller = new AbortController();

    query.mockImplementation(unanswered);

    const result = followTransaction(hash, { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(await settled(result)).toBeNull();
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("should not check once the last pause ends at the timeout", async () => {
    query.mockResolvedValue({ tx: null });

    const result = followTransaction(hash, { timeout: FOLLOW_INTERVAL / 2 });

    await vi.advanceTimersByTimeAsync(FOLLOW_INTERVAL);

    await expect(result).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("should refuse a hash that isn't one", async () => {
    await expect(
      followTransaction('") { id } block(height: 1')
    ).rejects.toThrow("Invalid transaction hash");
    expect(connect).not.toHaveBeenCalled();
  });
});
