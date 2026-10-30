import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataDrivers } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";
import {
  duskPerStDusk,
  encodeU64,
  feePercent,
  leastSozuStake,
  parseFeeRate,
  parsePool,
  sozuStake,
  sozuUnstakeAllowed,
} from "@dusk-network/networks/sozu";
import vectors from "@dusk-network/networks/fixtures/sozu-vectors.json";
import {
  MULTICALL_CONTRACT_ID,
  createMulticallFetch,
} from "@hdauven/dusk-multicall";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { get } from "svelte/store";

import { noteSozuPool, readSozuStatus, sozuContractsFor, sozuPools } from "..";

const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
const HUB = "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e";
const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

/** @param {string} hex */
const fromHex = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** A u64 as the contracts answer it, little-endian. */
const u64 = (/** @type {bigint} */ value) => encodeU64(value);

/** Testnet's rate, as the pool answers it: about 3.0751 DUSK a stDUSK. */
const RATE = Uint8Array.of(
  242,
  246,
  253,
  56,
  231,
  237,
  28,
  0,
  149,
  221,
  34,
  4,
  87,
  104,
  9,
  0
);

/** Sozu's fees on testnet, as its substrate gave them on 27 Oct 2026. */
const TESTNET_FEES = {
  deposit: fromHex("19000000000000001027000000000000"),
  reward: fromHex("0a000000000000006400000000000000"),
};

/** A hub's answer: a contract ID it names. */
const named = (/** @type {string} */ id) => Uint8Array.of(1, ...fromHex(id));

/**
 * An `aggregate` reply as Multicall for Dusk writes it (rkyv 0.7): each
 * result's bytes, then one 16-byte slot per result, then the root.
 *
 * @param {Uint8Array[]} results
 */
function multicallReply(results) {
  /**
   * @param {number} n
   * @param {number} to
   */
  const align = (n, to) => Math.ceil(n / to) * to;
  const data = results.reduce((n, r) => n + r.length, 0);
  const slots = align(data, 4);
  const root = align(slots + 16 * results.length, 8);
  const out = new Uint8Array(root + 16);
  const view = new DataView(out.buffer);
  let at = 0;

  results.forEach((r, i) => {
    const slot = slots + 16 * i;

    out.set(r, at);
    view.setInt32(slot + 4, at - (slot + 4), true);
    view.setUint32(slot + 8, r.length, true);
    at += r.length;
  });
  view.setBigUint64(root, 7n, true);
  view.setInt32(root + 8, slots - (root + 8), true);
  view.setUint32(root + 12, results.length, true);

  return out;
}

/** @param {string} name */
async function loadDriver(name) {
  const bytes = await readFile(
    resolve(process.cwd(), "static/drivers", `${name}_data_driver.wasm`)
  );
  const driver = await dataDrivers.load(new Uint8Array(bytes));

  driver.init();

  return driver;
}

describe("the Sozu test vectors both wallets run", () => {
  /** @param {string} hex */
  const bytes = (hex) =>
    Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

  /** @param {string} name */
  const pool = (name) =>
    parsePool(vectors.pools[/** @type {keyof typeof vectors.pools} */ (name)]);

  /** @param {string | null} name */
  const deposit = (name) =>
    name
      ? parseFeeRate(
          bytes(
            vectors.fees[/** @type {keyof typeof vectors.fees} */ (name)]
              .deposit
          )
        )
      : null;

  it("reads each fee rate from the substrate's bytes, and as a percentage", () => {
    for (const rate of vectors.feeRates) {
      const parsed = parseFeeRate(bytes(rate.bytes));

      expect(parsed).toStrictEqual({
        denominator: BigInt(rate.denominator),
        numerator: BigInt(rate.numerator),
      });
      expect(feePercent(parsed, "en")).toBe(rate.percent);
    }
  });

  it("values a stDUSK at each pool's rate, and nothing without one", () => {
    for (const value of vectors.duskPerStDusk) {
      expect(duskPerStDusk(pool(value.pool))).toBe(
        value.lux === null ? null : BigInt(value.lux)
      );
    }
  });

  it.each(vectors.stakes)(
    "takes a stake of $amount lux on the $pool pool with $fees fees: fee $fee, worth $worth, $stDusk stDUSK, goes ahead: $ok",
    (stake) => {
      expect(
        sozuStake(BigInt(stake.amount), pool(stake.pool), deposit(stake.fees))
      ).toStrictEqual({
        fee: BigInt(stake.fee),
        ok: stake.ok,
        stDusk: BigInt(stake.stDusk),
        worth: BigInt(stake.worth),
      });
    }
  );

  it.each(vectors.minimums)(
    "gives the least stake that goes ahead on the $pool pool with $fees fees: $least lux",
    (minimum) => {
      expect(leastSozuStake(pool(minimum.pool), deposit(minimum.fees))).toBe(
        minimum.least === null ? null : BigInt(minimum.least)
      );
    }
  );

  it.each(vectors.minimums.filter(({ least }) => least !== null))(
    "lets a stake of the least on the $pool pool with $fees fees go ahead, and nothing under it",
    (minimum) => {
      const least = BigInt(/** @type {string} */ (minimum.least));
      const rate = deposit(minimum.fees);

      expect(sozuStake(least, pool(minimum.pool), rate).ok).toBe(true);
      expect(sozuStake(least - 1n, pool(minimum.pool), rate).ok).toBe(false);
    }
  );

  it.each(vectors.unstakes)(
    "lets an unstake of $amount lux with $balance lux at Sozu go ahead: $ok",
    (unstake) => {
      expect(
        sozuUnstakeAllowed(BigInt(unstake.amount), BigInt(unstake.balance))
      ).toBe(unstake.ok);
    }
  );
});

describe("Sozu's contracts", () => {
  beforeEach(() => {
    setNodeNetwork(networks.testnet);
  });

  afterEach(() => {
    localStorage.clear();
    setNodeNetwork(null);
  });

  it("takes its hub, and the contracts to read until it answers, from the network's file", () => {
    expect(sozuContractsFor(networks.testnet)).toMatchObject({
      fallbacks: { pool: POOL },
      hub: HUB,
    });
    expect(sozuContractsFor(networks.mainnet)?.hub).toMatch(/^[0-9a-f]{64}$/);
    expect(sozuContractsFor(networks.devnet)).toBeNull();
    expect(sozuContractsFor(null)).toBeNull();
  });

  it("keeps the pools its hub named, from then on and on this device", async () => {
    const pool = "ef".repeat(32);

    expect(get(sozuPools).has(pool)).toBe(false);

    noteSozuPool(`0x${pool.toUpperCase()}`);

    expect(get(sozuPools).has(pool)).toBe(true);

    // Kept for the next visit.
    vi.resetModules();

    const again = await import("../config");

    expect(get(again.sozuPools).has(pool)).toBe(true);
  });
});

describe("Sozu's pool data driver", () => {
  it("works with this wallet's w3sper: it encodes the account a balance is read for, and a call's amount as the package does", async () => {
    const pool = await loadDriver("sozu_pool");

    expect(pool.encodeInputFn("sozu_stake", '"1000000000000"')).toStrictEqual(
      encodeU64(1_000_000_000_000n)
    );
    expect(pool.encodeInputFn("balance_of", JSON.stringify(ACCOUNT))).toEqual(
      expect.any(Uint8Array)
    );
  });
});

describe("readSozuStatus", () => {
  const NEW_POOL = "ee".repeat(32);
  const TOKEN = "dd".repeat(32);
  const SUBSTRATE = "cc".repeat(32);
  const ACCOUNT_ARG = Uint8Array.of(7, 7, 7);

  /** A pool driver that encodes the account as ACCOUNT_ARG. */
  const loadPool = async () =>
    /** @type {SozuDriver} */ ({
      decodeOutputFn: () => null,
      encodeInputFn: (fn, json) => {
        expect([fn, json]).toStrictEqual([
          "balance_of",
          JSON.stringify(ACCOUNT),
        ]);

        return ACCOUNT_ARG;
      },
    });

  /**
   * The contracts and functions in an `aggregate` envelope, as the multicall's
   * codec writes them: "<contract's first 8>.<fn>".
   *
   * @param {any} body
   */
  function envelopeCalls(body) {
    const u8 = new Uint8Array(body);
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const root = u8.length - 8;
    const array = root + view.getInt32(root, true);

    return Array.from({ length: view.getUint32(root + 4, true) }, (_, i) => {
      const slot = array + 56 * i;
      const inline = u8[slot + 39] <= 7;
      const name = inline
        ? slot + 32
        : slot + 32 + view.getInt32(slot + 36, true);
      const length = inline ? u8[slot + 39] : view.getUint32(slot + 32, true);
      const contract = Array.from(u8.subarray(slot, slot + 4), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");

      return `${contract}.${new TextDecoder().decode(u8.subarray(name, name + length))}`;
    });
  }

  /**
   * A node behind Multicall for Dusk: each query's calls, and its replies,
   * from `answer`.
   *
   * @param {string} nodeUrl
   * @param {(calls: string[], query: number) => Uint8Array[]} answer
   */
  function multicallNode(nodeUrl, answer) {
    /** @type {string[][]} */
    const queries = [];
    const base = vi.fn(async (/** @type {string} */ _url, init) => {
      const calls = envelopeCalls(init.body);

      queries.push(calls);

      return new Response(multicallReply(answer(calls, queries.length)));
    });

    return {
      fetch: createMulticallFetch({
        fetch: /** @type {typeof globalThis.fetch} */ (
          /** @type {unknown} */ (base)
        ),
        multicallId: MULTICALL_CONTRACT_ID,
        nodeUrl,
      }),
      queries,
    };
  }

  it("reads one by one on a network without Multicall for Dusk, as a local node's", async () => {
    /** @type {string[]} */
    const asked = [];
    /** @param {string} nodeUrl */
    const read = (nodeUrl) =>
      readSozuStatus({
        account: ACCOUNT,
        contracts: {
          fallbacks: { pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
          hub: HUB,
        },
        loadDriver: loadPool,
        nodeUrl,
      }).catch(() => null);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (/** @type {string} */ url) => {
        asked.push(String(url));

        return new Response(new Uint8Array(), { status: 500 });
      })
    );

    try {
      setNodeNetwork(networks.devnet);
      await read("https://local.example");

      expect(asked.length).toBeGreaterThan(1);
      expect(asked.filter((url) => url.endsWith("/aggregate"))).toStrictEqual(
        []
      );

      asked.length = 0;
      setNodeNetwork(networks.testnet);
      await read("https://testnet.example");

      expect(asked[0]).toBe(
        `https://testnet.example/on/contracts:${MULTICALL_CONTRACT_ID}/aggregate`
      );
    } finally {
      setNodeNetwork(null);
      vi.unstubAllGlobals();
    }
  });

  it("reads the hub's names with the figures in one Multicall for Dusk query, the account as the pool's driver encodes it", async () => {
    /** @type {Uint8Array[]} */
    const args = [];
    const node = multicallNode("https://one.example", () => [
      named(POOL),
      named(TOKEN),
      named(SUBSTRATE),
      RATE,
      u64(1_500_000_000_000n),
      u64(487_000_000_000n),
      TESTNET_FEES.deposit,
      TESTNET_FEES.reward,
      Uint8Array.of(0),
      Uint8Array.of(1),
    ]);
    const status = await readSozuStatus({
      account: ACCOUNT,
      contracts: {
        fallbacks: { pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
        hub: HUB,
      },
      fetch: /** @type {typeof fetch} */ (
        async (url, init) => {
          args.push(new Uint8Array(/** @type {any} */ (init?.body)));

          return node.fetch(url, init);
        }
      ),
      loadDriver: loadPool,
      nodeUrl: "https://one.example",
    });

    expect(status).toMatchObject({
      contracts: { hub: HUB, pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
      fees: {
        deposit: { denominator: 10_000n, numerator: 25n },
        reward: { denominator: 100n, numerator: 10n },
      },
      flags: { maintenance: false, synchronization: true },
      pool: parsePool(parseFeeRate(RATE)),
      position: { balance: 1_500_000_000_000n, stDusk: 487_000_000_000n },
    });
    expect(node.queries).toStrictEqual([
      [
        "bae85f8c.contract",
        "bae85f8c.contract",
        "bae85f8c.contract",
        "72883945.exchange_rate",
        "72883945.balance_of",
        "dddddddd.balance_of",
        "cccccccc.stake_fee_rate",
        "cccccccc.stake_fee_rate",
        "cccccccc.is_feature_enabled",
        "cccccccc.is_feature_enabled",
      ],
    ]);
    // Both balances are read for the account as the pool's driver wrote it.
    expect(
      args.filter((arg) => arg.length === ACCOUNT_ARG.length)
    ).toHaveLength(2);
  });

  it("names the calls of the pool the hub names for the history, and reads that pool's figures", async () => {
    const node = multicallNode("https://two.example", (calls) =>
      calls[0].endsWith(".contract")
        ? [
            named(NEW_POOL),
            named(TOKEN),
            named(SUBSTRATE),
            ...calls
              .slice(3)
              .map((call) =>
                call.endsWith("exchange_rate")
                  ? RATE
                  : call.endsWith("balance_of")
                    ? u64(5n)
                    : call.endsWith("is_feature_enabled")
                      ? Uint8Array.of(0)
                      : TESTNET_FEES.deposit
              ),
          ]
        : calls.map((call) =>
            call.endsWith("exchange_rate")
              ? RATE
              : call.endsWith("balance_of")
                ? u64(9n)
                : call.endsWith("is_feature_enabled")
                  ? Uint8Array.of(0)
                  : TESTNET_FEES.deposit
          )
    );

    const status = await readSozuStatus({
      account: ACCOUNT,
      contracts: {
        fallbacks: { pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
        hub: "ab".repeat(32),
      },
      fetch: node.fetch,
      loadDriver: loadPool,
      nodeUrl: "https://two.example",
    });

    expect(status.contracts.pool).toBe(NEW_POOL);
    expect(status.position).toStrictEqual({ balance: 9n, stDusk: 9n });
    expect(get(sozuPools).has(NEW_POOL)).toBe(true);
  });

  it("fails when the pool's rate or a balance can't be read, saying why", async () => {
    const node = multicallNode("https://three.example", (calls) =>
      calls.map((call) =>
        call.endsWith(".contract")
          ? named(call.startsWith("abababab") ? POOL : POOL)
          : call.endsWith("exchange_rate")
            ? Uint8Array.of(1, 2, 3)
            : u64(0n)
      )
    );

    await expect(
      readSozuStatus({
        account: ACCOUNT,
        contracts: {
          fallbacks: { pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
          hub: "ba".repeat(32),
        },
        fetch: node.fetch,
        loadDriver: loadPool,
        nodeUrl: "https://three.example",
      })
    ).rejects.toThrow();
  });
});
