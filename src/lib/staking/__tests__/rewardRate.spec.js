import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeRateEstimate } from "@dusk-network/networks/rates";

import {
  ratePercent,
  readNativeRewardRate,
  readNativeRewards,
} from "../rewardRate";

/** What app-core measures of native staking's rewards from the chain. */
const chain = vi.hoisted(() => ({ nativeRewards: vi.fn() }));

vi.mock("@dusk-network/app-core/sozu", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  nativeRewards: chain.nativeRewards,
}));

/** Two provisioners, as /on/node/provisioners gives them: 3M DUSK eligible. */
const PROVISIONERS = [
  { amount: 1_000_000_000_000_000, eligibility: 10 },
  { amount: 2_000_000_000_000_000, eligibility: 20 },
];
const TIP = 4_700_000n;
const NOW = Date.UTC(2026, 9, 28, 12);
const DAY = 86_400_000;

/** @param {unknown} reply */
const nodeAnswering = (reply, ok = true) =>
  vi.fn(
    async () => new Response(JSON.stringify(reply), { status: ok ? 200 : 500 })
  );

describe("readNativeRewardRate", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("estimates what native staking pays a year from one read of the node's provisioners, kept a day", async () => {
    const fetch = nodeAnswering(PROVISIONERS);
    const options = {
      fetch: /** @type {typeof globalThis.fetch} */ (
        /** @type {unknown} */ (fetch)
      ),
      network: "testnet",
      nodeUrl: "https://node.example",
      tipHeight: async () => TIP,
    };
    const expected = nativeRateEstimate({
      provisioners: PROVISIONERS,
      tipHeight: TIP,
    });

    await expect(readNativeRewardRate({ ...options, now: NOW })).resolves.toBe(
      expected
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://node.example/on/node/provisioners",
      { method: "POST" }
    );

    // Within the day: no read.
    await expect(
      readNativeRewardRate({ ...options, now: NOW + DAY - 1 })
    ).resolves.toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Another network has its own.
    await readNativeRewardRate({ ...options, network: "mainnet", now: NOW });
    expect(fetch).toHaveBeenCalledTimes(2);

    // A day later: read again.
    await readNativeRewardRate({ ...options, now: NOW + DAY });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives nothing when the read fails, and reads again next time", async () => {
    const failing = nodeAnswering({}, false);
    const options = {
      network: "testnet",
      nodeUrl: "https://node.example",
      now: NOW,
      tipHeight: async () => TIP,
    };

    await expect(
      readNativeRewardRate({
        ...options,
        fetch: /** @type {typeof globalThis.fetch} */ (
          /** @type {unknown} */ (failing)
        ),
      })
    ).resolves.toBeNull();

    const working = nodeAnswering(PROVISIONERS);

    await expect(
      readNativeRewardRate({
        ...options,
        fetch: /** @type {typeof globalThis.fetch} */ (
          /** @type {unknown} */ (working)
        ),
      })
    ).resolves.toBeGreaterThan(0);
  });

  it("gives nothing while nothing is staked", async () => {
    await expect(
      readNativeRewardRate({
        fetch: /** @type {typeof globalThis.fetch} */ (
          /** @type {unknown} */ (nodeAnswering([]))
        ),
        network: "devnet",
        nodeUrl: "https://node.example",
        now: NOW,
        tipHeight: async () => TIP,
      })
    ).resolves.toBeNull();
  });
});

describe("readNativeRewards", () => {
  /** 15.6 DUSK a block to stakers over the last 30 days. */
  const MEASURED = {
    blocks: 6,
    days: 30,
    from: { at: NOW - 30 * DAY, height: 4_440_800 },
    perBlock: 15_600_000_000n,
    rate: 0.88,
    staked: 3_000_000_000_000_000n,
    to: { at: NOW, height: 4_700_000 },
  };

  /** @param {ReturnType<typeof nodeAnswering>} fetch @param {string} network */
  const optionsFor = (fetch, network) => ({
    fetch: /** @type {typeof globalThis.fetch} */ (
      /** @type {unknown} */ (fetch)
    ),
    network,
    nodeUrl: "https://node.example",
    tipHeight: async () => TIP,
  });

  afterEach(() => {
    chain.nativeRewards.mockReset();
    localStorage.clear();
  });

  it("measures what native staking paid from the chain, says over how many days, and keeps it an hour", async () => {
    const fetch = nodeAnswering(PROVISIONERS);
    const options = optionsFor(fetch, "testnet");

    chain.nativeRewards.mockResolvedValue(MEASURED);

    await expect(readNativeRewards({ ...options, now: NOW })).resolves.toEqual({
      days: 30,
      native: MEASURED,
      rate: 0.88,
    });
    // What's staked now, at the node's tip.
    expect(chain.nativeRewards).toHaveBeenCalledWith(
      expect.objectContaining({ provisioners: PROVISIONERS, tipHeight: TIP })
    );

    // Within the hour: no read.
    await readNativeRewards({ ...options, now: NOW + 3_599_999 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chain.nativeRewards).toHaveBeenCalledTimes(1);

    // An hour later: read again.
    await readNativeRewards({ ...options, now: NOW + 3_600_000 });
    expect(chain.nativeRewards).toHaveBeenCalledTimes(2);
  });

  it("estimates it, of no period, where the chain can't say; and reads again next time where nothing could be read", async () => {
    chain.nativeRewards.mockResolvedValue(null);

    await expect(
      readNativeRewards({
        ...optionsFor(nodeAnswering(PROVISIONERS), "mainnet"),
        now: NOW,
      })
    ).resolves.toEqual({
      days: null,
      native: null,
      rate: nativeRateEstimate({ provisioners: PROVISIONERS, tipHeight: TIP }),
    });

    const failing = nodeAnswering({}, false);

    await expect(
      readNativeRewards({ ...optionsFor(failing, "devnet"), now: NOW })
    ).resolves.toEqual({ days: null, native: null, rate: null });

    chain.nativeRewards.mockResolvedValue(MEASURED);

    await expect(
      readNativeRewards({
        ...optionsFor(nodeAnswering(PROVISIONERS), "devnet"),
        now: NOW + 1,
      })
    ).resolves.toEqual({ days: 30, native: MEASURED, rate: 0.88 });
  });
});

describe("ratePercent", () => {
  it("says a yearly rate as a whole percentage, in the language's way", () => {
    expect(ratePercent(0.235, "en")).toBe("24%");
    expect(ratePercent(0.2, "en")).toBe("20%");
    expect(ratePercent(0.2, "de")).toBe("20\u00a0%");
  });
});
