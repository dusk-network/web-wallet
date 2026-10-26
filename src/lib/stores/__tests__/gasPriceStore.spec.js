import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("$lib/stores/networkStore", () => ({ default: { connect } }));

describe("gasPriceStore", () => {
  /** @type {GasPriceStore} */
  let gasPriceStore;

  /** @param {Record<string, bigint>} stats */
  const nodeGives = (stats) =>
    connect.mockResolvedValue({ blocks: { gasPrice: Promise.resolve(stats) } });

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

  it("should take the node's median price", async () => {
    nodeGives({ average: 4n, max: 9n, median: 3n, min: 1n });

    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(3n);
  });

  it("should never go under the lowest price", async () => {
    nodeGives({ average: 0n, max: 0n, median: 0n, min: 0n });

    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(1n);
  });

  it("should keep the last price while the node can't give one", async () => {
    nodeGives({ average: 2n, max: 2n, median: 2n, min: 2n });
    await gasPriceStore.refresh();

    connect.mockRejectedValue(new Error("Timed out"));
    await gasPriceStore.refresh();

    expect(get(gasPriceStore)).toBe(2n);
  });

  it("should ask again every five minutes until it is stopped", async () => {
    vi.useFakeTimers();
    nodeGives({ average: 2n, max: 2n, median: 2n, min: 2n });

    const stop = gasPriceStore.startRefreshing();

    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(get(gasPriceStore)).toBe(2n);

    nodeGives({ average: 5n, max: 5n, median: 5n, min: 5n });
    await vi.advanceTimersByTimeAsync(300_000);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(get(gasPriceStore)).toBe(5n);

    stop();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(connect).toHaveBeenCalledTimes(2);
  });
});
