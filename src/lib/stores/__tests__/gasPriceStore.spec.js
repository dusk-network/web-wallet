import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("$lib/stores/networkStore", () => ({ default: { connect } }));

describe("gasPriceStore", () => {
  /** @type {GasPriceStore} */
  let gasPriceStore;

  /**
   * What waits in the node's mempool, as its GraphQL lists it.
   *
   * @param {Array<{ gasLimit: number, gasPrice: number }>} mempoolTxs
   */
  const nodeHolds = (mempoolTxs) =>
    connect.mockResolvedValue({
      query: vi.fn(async (/** @type {string} */ gql) =>
        gql === "mempoolTxs { gasPrice gasLimit }"
          ? { mempoolTxs }
          : Promise.reject(new Error(`Not asked here: ${gql}`))
      ),
    });

  /**
   * A block's worth waiting, each at `gasPrice`: more than the next block
   * takes.
   *
   * @param {number} gasPrice
   */
  const blockFull = (gasPrice) =>
    Array.from({ length: 1_000 }, () => ({ gasLimit: 2_500_000, gasPrice }));

  beforeEach(async () => {
    vi.resetModules();
    gasPriceStore = (await import("../gasPriceStore")).default;
  });

  afterEach(() => {
    connect.mockReset();
    vi.useRealTimers();
  });

  it("should start from the configured default price", () => {
    expect(get(gasPriceStore)).toBe(1n);
  });

  it("should take the lowest while what waits fits in the next block, as Sozu's activation waiting alone at 2 after a stake", async () => {
    nodeHolds([{ gasLimit: 6_000_000, gasPrice: 2 }]);

    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(1n);
    expect(get(gasPriceStore.rule)).toMatchObject({
      busy: false,
      median: 2n,
      price: 1n,
    });

    // Nothing waiting: the lowest.
    nodeHolds([]);
    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(1n);
  });

  it("should take the median of a block's worth up to five times the lowest, by app-core's rule for both wallets, and say the network is busy over it", async () => {
    const { GAS_PRICE_CEILING_TIMES, defaultGasPrice } =
      await import("@dusk-network/app-core/gas");

    nodeHolds(blockFull(3));
    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(3n);
    expect(get(gasPriceStore.rule)).toMatchObject({ busy: false, median: 3n });

    // A spammed mempool: the default stops at the ceiling, and says so.
    nodeHolds(blockFull(900));
    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(GAS_PRICE_CEILING_TIMES);
    expect(get(gasPriceStore.rule)).toStrictEqual(
      defaultGasPrice({ mempool: blockFull(900), minimum: 1n })
    );
    expect(get(gasPriceStore.rule)).toMatchObject({
      busy: true,
      median: 900n,
      price: 5n,
    });
  });

  it("should ask again as a form opens, where the price was read longer ago than half a minute", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 13, 12) });
    nodeHolds(blockFull(2));

    // Never read: asked.
    await gasPriceStore.readAgain();

    expect(connect).toHaveBeenCalledOnce();

    // Read moments ago: kept.
    vi.setSystemTime(Date.UTC(2026, 10, 13, 12, 0, 29));
    await gasPriceStore.readAgain();

    expect(connect).toHaveBeenCalledOnce();

    // Older: asked again.
    nodeHolds(blockFull(3));
    vi.setSystemTime(Date.UTC(2026, 10, 13, 12, 0, 31));
    await gasPriceStore.readAgain();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(get(gasPriceStore)).toBe(3n);
  });

  it("should never go under the lowest price", async () => {
    nodeHolds(blockFull(0));

    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(1n);
  });

  it("should keep the last price while the node can't give one", async () => {
    nodeHolds(blockFull(2));
    await gasPriceStore.refresh();

    connect.mockRejectedValue(new Error("Timed out"));
    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(2n);
  });

  it("should ask again every five minutes until it is stopped", async () => {
    vi.useFakeTimers();
    nodeHolds(blockFull(2));

    const stop = gasPriceStore.startRefreshing();

    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(get(gasPriceStore)).toBe(2n);

    nodeHolds(blockFull(5));
    await vi.advanceTimersByTimeAsync(300_000);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(get(gasPriceStore)).toBe(5n);

    stop();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(connect).toHaveBeenCalledTimes(2);
  });
});
