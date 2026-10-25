import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

describe("Shielded status store", () => {
  const tip = 4_680_000n;

  /** @type {NetworkStore} */
  let networkStore;

  /** @type {ShieldedStatusStore} */
  let shieldedStatusStore;

  /** @type {import("vitest").MockInstance<NetworkStore["getNodeFeatures"]>} */
  let getNodeFeaturesSpy;

  /** @type {import("vitest").MockInstance<NetworkStore["getCurrentBlockHeight"]>} */
  let getCurrentBlockHeightSpy;

  /** @param {Record<string, unknown>} features */
  async function refreshWith(features) {
    getNodeFeaturesSpy.mockResolvedValueOnce(features);
    await shieldedStatusStore.refresh();
  }

  beforeEach(async () => {
    vi.resetModules();

    shieldedStatusStore = (await import("../shieldedStatusStore")).default;
    networkStore = (await import("../networkStore")).default;
    getNodeFeaturesSpy = vi.spyOn(networkStore, "getNodeFeatures");
    getCurrentBlockHeightSpy = vi
      .spyOn(networkStore, "getCurrentBlockHeight")
      .mockResolvedValue(tip);
  });

  it("should not count shielded transactions as paused before it knows", () => {
    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: false,
      isPaused: false,
    });
  });

  it("should pause shielded transactions when the node has them off for the next block", async () => {
    await refreshWith({ DISABLE_PHOENIX: Number(tip + 1n) });

    expect(getNodeFeaturesSpy).toHaveBeenCalledTimes(1);
    expect(getCurrentBlockHeightSpy).toHaveBeenCalledTimes(1);
    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: true,
    });
  });

  it("should not pause shielded transactions when the node turns them off only after the next block", async () => {
    await refreshWith({ DISABLE_PHOENIX: Number(tip + 2n) });

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: false,
    });
  });

  it("should not pause shielded transactions on a node that never turns them off", async () => {
    // u64::MAX, as JSON numbers carry it
    await refreshWith({ BLOB: 1, DISABLE_PHOENIX: Number(2n ** 64n - 1n) });

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: false,
    });

    await refreshWith({ BLOB: 1 });

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: false,
    });
  });

  it("should resume shielded transactions once the node turns them back on", async () => {
    await refreshWith({ DISABLE_PHOENIX: [[1, Number(tip + 1n)]] });

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: true,
    });

    await refreshWith({ DISABLE_PHOENIX: [[1, Number(tip)]] });

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: false,
    });
  });

  it("should not let an older refresh replace the answer of a newer one", async () => {
    /** @type {PromiseWithResolvers<Record<string, unknown>>} */
    const older = Promise.withResolvers();
    const paused = { isKnown: true, isPaused: true };

    getNodeFeaturesSpy
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ DISABLE_PHOENIX: 1 });

    const olderRefresh = shieldedStatusStore.refresh();

    await shieldedStatusStore.refresh();

    expect(get(shieldedStatusStore)).toStrictEqual(paused);

    older.resolve({});
    await olderRefresh;

    expect(get(shieldedStatusStore)).toStrictEqual(paused);
  });

  it("should apply an older refresh that answers first, until the newer one answers", async () => {
    /** @type {PromiseWithResolvers<Record<string, unknown>>} */
    const newer = Promise.withResolvers();

    getNodeFeaturesSpy
      .mockResolvedValueOnce({ DISABLE_PHOENIX: 1 })
      .mockReturnValueOnce(newer.promise);

    const olderRefresh = shieldedStatusStore.refresh();
    const newerRefresh = shieldedStatusStore.refresh();

    await olderRefresh;

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: true,
    });

    newer.resolve({});
    await newerRefresh;

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: true,
      isPaused: false,
    });
  });

  it("should keep a pause when the node answers with an error, or without its features", async () => {
    const fetchMock = vi.mocked(fetch);
    const paused = { isKnown: true, isPaused: true };

    fetchMock.mockResolvedValueOnce(
      // eslint-disable-next-line camelcase
      Response.json({ vm_config: { features: { DISABLE_PHOENIX: 1 } } })
    );
    await shieldedStatusStore.refresh();

    expect(get(shieldedStatusStore)).toStrictEqual(paused);

    const answers = [
      Response.json({ error: "Service unavailable" }, { status: 503 }),
      Response.json({ error: "Service unavailable" }),
      new Response("Bad gateway"),
    ];

    for (const answer of answers) {
      fetchMock.mockResolvedValueOnce(answer);
      await shieldedStatusStore.refresh();

      expect(get(shieldedStatusStore)).toStrictEqual(paused);
    }
  });

  it("should keep what it knew when the node can't tell", async () => {
    const paused = { isKnown: true, isPaused: true };

    await refreshWith({ DISABLE_PHOENIX: 1 });

    expect(get(shieldedStatusStore)).toStrictEqual(paused);

    getNodeFeaturesSpy.mockRejectedValueOnce(new Error("Node unreachable"));
    await shieldedStatusStore.refresh();

    expect(get(shieldedStatusStore)).toStrictEqual(paused);

    getNodeFeaturesSpy.mockResolvedValueOnce({});
    getCurrentBlockHeightSpy.mockRejectedValueOnce(new Error("Query failed"));
    await shieldedStatusStore.refresh();

    expect(get(shieldedStatusStore)).toStrictEqual(paused);
  });

  it("should stay unknown and not paused when the node can't tell before it ever knew", async () => {
    getNodeFeaturesSpy.mockRejectedValueOnce(new Error("Node unreachable"));
    await shieldedStatusStore.refresh();

    expect(get(shieldedStatusStore)).toStrictEqual({
      isKnown: false,
      isPaused: false,
    });
  });
});
