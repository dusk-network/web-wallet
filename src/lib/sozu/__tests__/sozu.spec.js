import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataDrivers } from "@dusk/w3sper";

import { createMulticallFetch } from "$lib/activity/multicallFetch";

import {
  SOZU_FN,
  duskPerStDusk,
  encodeU64,
  feePercent,
  isSozuCall,
  leastSozuStake,
  noteSozuPool,
  parseFeeRate,
  parsePool,
  readSozuStatus,
  sozuContractsFor,
  sozuFee,
  sozuStake,
  sozuUnstakeAllowed,
  stDuskFor,
} from "..";
import { sozuCall } from "../calls";

import vectors from "./sozu-vectors.json";

const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
const HUB = "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e";
const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

/** Testnet's rate, as read on 26 Oct 2026: about 3.0751 DUSK a stDUSK. */
const RATE = {
  denominator: "2647997731233173",
  numerator: "8142876697294578",
};

/**
 * An `aggregate` reply as Multicall for Dusk writes it (rkyv 0.7): each
 * result's bytes, then one 16-byte slot per result, then the root. As in
 * multicallFetch.spec.js.
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

describe("Sozu amounts", () => {
  it("encodes an amount as a little-endian u64", () => {
    expect(Array.from(encodeU64(1_000_000_000_000n))).toStrictEqual([
      0, 16, 165, 212, 232, 0, 0, 0,
    ]);
    expect(() => encodeU64(-1n)).toThrow(RangeError);
    expect(() => encodeU64(2n ** 64n)).toThrow(RangeError);
  });

  it("reads the pool's rate, and what DUSK gets in stDUSK and back", () => {
    const pool = parsePool(RATE);

    expect(pool).toStrictEqual({
      stake: 8_142_876_697_294_578n,
      supply: 2_647_997_731_233_173n,
    });
    expect(duskPerStDusk(pool)).toBe(3_075_107_127n);
    expect(stDuskFor(100_000_000_000n, pool)).toBe(32_519_192_291n);
    // A pool with no stake or no stDUSK mints 1:1, as its contract does.
    expect(stDuskFor(1n, parsePool({}))).toBe(1n);
    expect(stDuskFor(1n, null)).toBeNull();
    expect(duskPerStDusk(null)).toBeNull();
  });

  it("builds a pool call: a stake sends its amount along, an unstake nothing", () => {
    expect(sozuCall(POOL, SOZU_FN.STAKE, 1_000_000_000_000n)).toStrictEqual({
      deposit: 1_000_000_000_000n,
      payload: {
        contractId: Array.from(POOL.match(/../g) ?? [], (b) => parseInt(b, 16)),
        fnArgs: Uint8Array.of(0, 16, 165, 212, 232, 0, 0, 0),
        fnName: "sozu_stake",
      },
    });
    expect(sozuCall(`0x${POOL}`, SOZU_FN.UNSTAKE, 5n).deposit).toBe(0n);
    expect(() => sozuCall("nope", SOZU_FN.STAKE, 5n)).toThrow(TypeError);
    expect(() => sozuCall(POOL, SOZU_FN.STAKE, 0n)).toThrow(RangeError);
  });
});

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

describe("Sozu's least stake at fees near 100%", () => {
  const testnet = parsePool(vectors.pools["testnet-2026-10-26"]);
  const U64_MAX = 2n ** 64n - 1n;

  it("has none when no stake can go ahead: a fee over 100%, or a least past any u64 amount", () => {
    expect(
      leastSozuStake(testnet, { denominator: 2n, numerator: 3n })
    ).toBeNull();
    // A pool whose stDUSK is worth a u64's whole, and a fee of 1 lux in u64::MAX.
    expect(
      leastSozuStake(
        { stake: U64_MAX, supply: 1n },
        { denominator: U64_MAX, numerator: 1n }
      )
    ).toBeNull();
  });

  it("doesn't count its way there: a fee a hair under 100% takes no time", () => {
    const started = performance.now();

    expect(
      leastSozuStake(testnet, {
        denominator: 10_000_000n,
        numerator: 9_999_999n,
      })
    ).toBe(40_000_000n);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("gives what counting up gives, for small pools and fees", () => {
    /**
     * @param {bigint} from
     * @param {bigint} to
     * @param {bigint} [step]
     */
    const range = (from, to, step = 1n) =>
      Array.from(
        { length: Number((to - from) / step) + 1 },
        (_, i) => from + BigInt(i) * step
      );
    const cases = range(1n, 40n, 3n).flatMap((stake) =>
      range(1n, 40n, 7n).flatMap((supply) =>
        range(1n, 12n).flatMap((d) =>
          range(0n, d - 1n).map((n) => ({
            pool: { stake, supply },
            rate: { denominator: d, numerator: n },
          }))
        )
      )
    );

    /**
     * The least counted up to, a lux at a time.
     *
     * @param {{ pool: SozuPool, rate: SozuFeeRate }} c
     */
    const counted = ({ pool, rate }) => {
      const least = (pool.stake + pool.supply - 1n) / pool.supply;
      let amount = least;

      while (amount - sozuFee(amount, rate) < least) {
        amount += 1n;
      }

      return amount;
    };

    expect(
      cases
        .filter((c) => leastSozuStake(c.pool, c.rate) !== counted(c))
        .map(
          ({ pool, rate }) =>
            `${pool.stake}/${pool.supply} at ${rate.numerator}/${rate.denominator}`
        )
    ).toStrictEqual([]);
    expect(cases).toHaveLength(14 * 6 * 78);
  });
});

describe("Sozu's contracts", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("has a hub, and the contracts it names, on mainnet and testnet only", () => {
    // As the hubs named them on 28 Oct 2026.
    expect(sozuContractsFor("testnet")).toStrictEqual({
      hub: HUB,
      pool: POOL,
      stDusk:
        "fdbf49102e76cf58224003451c6cb9e3403c54ff1d9042f8bc46ec25c6a4337c",
      substrate:
        "0077ecbf88aa20d6d0a6afa20bd26300a2b562fdbac368bf1e3c1325e8555941",
    });
    expect(Object.values(sozuContractsFor("mainnet") ?? {})).toHaveLength(4);
    expect(sozuContractsFor("mainnet")?.pool).toMatch(/^[0-9a-f]{64}$/);
    expect(sozuContractsFor("devnet")).toBeNull();
    expect(sozuContractsFor("toString")).toBeNull();
  });

  it("names the calls of a pool its hub named, from then on and on this device", async () => {
    const pool = "ef".repeat(32);
    const call = { contractId: pool, fnName: "sozu_stake" };

    expect(isSozuCall(call)).toBe(false);

    noteSozuPool(`0x${pool.toUpperCase()}`);

    expect(isSozuCall(call)).toBe(true);

    // Kept for the next visit.
    vi.resetModules();

    const again = await import("../config");

    expect(again.isSozuCall(call)).toBe(true);
    expect(again.isSozuCall({ ...call, fnName: "balance_of" })).toBe(false);
  });

  it("knows its pools' calls", () => {
    expect(isSozuCall({ contractId: POOL, fnName: "sozu_stake" })).toBe(true);
    expect(
      isSozuCall({ contractId: `0x${POOL}`, fnName: "sozu_unstake" })
    ).toBe(true);
    expect(isSozuCall({ contractId: POOL, fnName: "balance_of" })).toBe(false);
    expect(
      isSozuCall({ contractId: "cd".repeat(32), fnName: "sozu_stake" })
    ).toBe(false);
  });
});

describe("Sozu's data drivers", () => {
  it("work with this wallet's w3sper: the hub's lookups and the pool's calls and reads", async () => {
    const hub = await loadDriver("sozu_hub");
    const pool = await loadDriver("sozu_pool");
    const token = await loadDriver("sozu_staked_dusk");

    expect(Array.from(hub.encodeInputFn("contract", '"pool"'))).toStrictEqual([
      112, 111, 111, 108, 0, 0, 0, 4,
    ]);
    expect(
      hub.decodeOutputFn("contract", Uint8Array.of(1, ...Array(32).fill(0xab)))
    ).toBe("ab".repeat(32));
    expect(hub.decodeOutputFn("contract", new Uint8Array(33))).toBeNull();

    // What the wallet builds itself is what the pool's driver encodes.
    expect(pool.encodeInputFn("sozu_stake", '"1000000000000"')).toStrictEqual(
      encodeU64(1_000_000_000_000n)
    );
    expect(
      pool.decodeOutputFn(
        "exchange_rate",
        Uint8Array.of(
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
        )
      )
    ).toStrictEqual(RATE);
    expect(pool.encodeInputFn("balance_of", JSON.stringify(ACCOUNT))).toEqual(
      expect.any(Uint8Array)
    );
    expect(
      token.decodeOutputFn("balance_of", Uint8Array.of(42, 0, 0, 0, 0, 0, 0, 0))
    ).toBe("42");
  });
});

/** @param {string} hex */
const fromHex = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** Sozu's fees on mainnet, as its substrate gave them on 27 Oct 2026. */
const MAINNET_FEES = {
  deposit: fromHex("01000000000000009001000000000000"),
  reward: fromHex("0f000000000000006400000000000000"),
};

/** And on testnet: its rewards' fee is another. */
const TESTNET_FEES = {
  deposit: fromHex("19000000000000001027000000000000"),
  reward: fromHex("0a000000000000006400000000000000"),
};

describe("Sozu's fees", () => {
  it("decode from the substrate's two little-endian u64s, and read as a percentage and an amount", () => {
    const deposit = parseFeeRate(MAINNET_FEES.deposit);
    const reward = parseFeeRate(MAINNET_FEES.reward);

    expect(deposit).toStrictEqual({ denominator: 400n, numerator: 1n });
    expect(reward).toStrictEqual({ denominator: 100n, numerator: 15n });
    expect([feePercent(deposit, "en"), feePercent(reward, "en")]).toStrictEqual(
      ["0.25%", "15%"]
    );
    expect(feePercent(parseFeeRate(TESTNET_FEES.reward), "en")).toBe("10%");
    // 0.25% of 1 DUSK; rounded up, as the pool takes it.
    expect(sozuFee(1_000_000_000n, deposit)).toBe(2_500_000n);
    expect(sozuFee(5n, deposit)).toBe(1n);
    expect(() => parseFeeRate(new Uint8Array(8))).toThrow(RangeError);
    // The least a stake gets stDUSK for, once the fee is off it.
    const pool = parsePool(RATE);

    expect(leastSozuStake(pool)).toBe(4n);
    expect(leastSozuStake(pool, deposit)).toBe(5n);
  });
});

describe("readSozuStatus", () => {
  /**
   * Drivers that read JSON and answer JSON, and a node that answers each
   * read from `replies`; the substrate's take a byte and give bytes.
   *
   * @param {Record<string, unknown>} replies By "<contract>/<fn>/<args>"
   */
  function fakeNode(replies) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /** @type {SozuDriver} */
    const driver = {
      decodeOutputFn: (_fn, bytes) => JSON.parse(decoder.decode(bytes)),
      encodeInputFn: (_fn, json) => encoder.encode(json),
    };
    const fetch = vi.fn(async (/** @type {string} */ url, init) => {
      const [, id, fn] = /contracts:([0-9a-f]+)\/(\w+)$/.exec(url) ?? [];
      const body = new Uint8Array(init.body);
      const key = `${id}/${fn}/${body.length === 1 ? `#${body[0]}` : decoder.decode(body)}`;
      const answer = replies[key];

      return !(key in replies)
        ? new Response("Unknown", { status: 500 })
        : answer instanceof Uint8Array
          ? new Response(answer.slice())
          : new Response(JSON.stringify(answer));
    });

    return {
      fetch: /** @type {typeof globalThis.fetch} */ (
        /** @type {unknown} */ (fetch)
      ),
      loadDriver: async () => driver,
      spy: fetch,
    };
  }

  const NEW_POOL = "ee".repeat(32);
  const TOKEN = "dd".repeat(32);
  const SUBSTRATE = "cc".repeat(32);

  /** A driver that writes JSON and reads it back. */
  const jsonDriver = () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    return /** @type {SozuDriver} */ ({
      decodeOutputFn: (_fn, bytes) => JSON.parse(decoder.decode(bytes)),
      encodeInputFn: (_fn, json) => encoder.encode(json),
    });
  };

  /** @param {unknown} value */
  const json = (value) => new TextEncoder().encode(JSON.stringify(value));

  /**
   * The contracts and functions in an `aggregate` envelope, as the vendored
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
        nodeUrl,
      }),
      queries,
    };
  }

  it("reads the pool and the stDUSK token the hub names, and the account's balances there", async () => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: NEW_POOL,
      [`${HUB}/contract/"staked-dusk"`]: TOKEN,
      [`${HUB}/contract/"substrate"`]: SUBSTRATE,
      [`${NEW_POOL}/balance_of/"${ACCOUNT}"`]: "1500000000000",
      [`${NEW_POOL}/exchange_rate/null`]: RATE,
      [`${SUBSTRATE}/stake_fee_rate/#0`]: MAINNET_FEES.deposit,
      [`${SUBSTRATE}/stake_fee_rate/#1`]: MAINNET_FEES.reward,
      // Maintenance off, synchronization on.
      [`${SUBSTRATE}/is_feature_enabled/#0`]: Uint8Array.of(0),
      [`${SUBSTRATE}/is_feature_enabled/#1`]: Uint8Array.of(1),
      [`${TOKEN}/balance_of/"${ACCOUNT}"`]: "487000000000",
    });

    await expect(
      readSozuStatus({
        account: ACCOUNT,
        contracts: { hub: HUB, pool: POOL },
        fetch: node.fetch,
        loadDriver: node.loadDriver,
        nodeUrl: "https://one.example",
      })
    ).resolves.toStrictEqual({
      contracts: { hub: HUB, pool: NEW_POOL, stDusk: TOKEN },
      fees: {
        deposit: { denominator: 400n, numerator: 1n },
        reward: { denominator: 100n, numerator: 15n },
      },
      flags: { maintenance: false, synchronization: true },
      pool: parsePool(RATE),
      position: { balance: 1_500_000_000_000n, stDusk: 487_000_000_000n },
    });
    // The history names the calls of the pool the hub named.
    expect(isSozuCall({ contractId: NEW_POOL, fnName: "sozu_stake" })).toBe(
      true
    );
    expect(node.spy.mock.calls.map(([url]) => url)).toStrictEqual([
      // The hub's names, with the figures of the pool known before…
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${POOL}/exchange_rate`,
      `https://one.example/on/contracts:${POOL}/balance_of`,
      // …and as the hub names others, the figures from those.
      `https://one.example/on/contracts:${NEW_POOL}/exchange_rate`,
      `https://one.example/on/contracts:${NEW_POOL}/balance_of`,
      `https://one.example/on/contracts:${TOKEN}/balance_of`,
      `https://one.example/on/contracts:${SUBSTRATE}/stake_fee_rate`,
      `https://one.example/on/contracts:${SUBSTRATE}/stake_fee_rate`,
      `https://one.example/on/contracts:${SUBSTRATE}/is_feature_enabled`,
      `https://one.example/on/contracts:${SUBSTRATE}/is_feature_enabled`,
    ]);
  });

  it("asks the hub again with every figure on each refresh, in one Multicall for Dusk query", async () => {
    // The hub's three names, then the pool's rate, the account's balances,
    // both fees and both switches: Sozu's maintenance on the second time.
    const node = multicallNode("https://five.example", (_calls, query) => [
      json(POOL),
      json(TOKEN),
      json(SUBSTRATE),
      json(RATE),
      json("0"),
      json("0"),
      TESTNET_FEES.deposit,
      TESTNET_FEES.reward,
      Uint8Array.of(query > 1 ? 1 : 0),
      Uint8Array.of(0),
    ]);
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
      fetch: node.fetch,
      loadDriver: async () => jsonDriver(),
      nodeUrl: "https://five.example",
    };

    // The rates follow the contract: testnet's reward fee is 10%, not mainnet's 15%.
    await expect(readSozuStatus(options)).resolves.toMatchObject({
      contracts: { pool: POOL, stDusk: TOKEN },
      fees: {
        deposit: { denominator: 10_000n, numerator: 25n },
        reward: { denominator: 100n, numerator: 10n },
      },
      flags: { maintenance: false, synchronization: false },
    });
    // Read again, the hub too: it can name others, and Sozu change its
    // figures, at any time.
    await expect(readSozuStatus(options)).resolves.toMatchObject({
      flags: { maintenance: true, synchronization: false },
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
      node.queries[0],
    ]);
  });

  it("follows the hub when it names another pool later in the session", async () => {
    let named = POOL;
    const figures = [
      json(RATE),
      json("1500000000000"),
      json("0"),
      TESTNET_FEES.deposit,
      TESTNET_FEES.reward,
      Uint8Array.of(0),
      Uint8Array.of(0),
    ];
    const node = multicallNode("https://six.example", (calls) =>
      calls.length === 10
        ? [json(named), json(TOKEN), json(SUBSTRATE), ...figures]
        : figures
    );
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
      fetch: node.fetch,
      loadDriver: async () => jsonDriver(),
      nodeUrl: "https://six.example",
    };

    await readSozuStatus(options);

    // An upgrade: the hub names a new pool. The next refresh reads it there…
    named = NEW_POOL;
    await expect(readSozuStatus(options)).resolves.toMatchObject({
      contracts: { pool: NEW_POOL },
      position: { balance: 1_500_000_000_000n },
    });
    // …and the one after, from it at once.
    await readSozuStatus(options);

    expect(node.queries.map((query) => query.length)).toStrictEqual([
      10, 10, 7, 10,
    ]);
    expect(node.queries[2][0]).toBe("eeeeeeee.exchange_rate");
    expect(node.queries[3][3]).toBe("eeeeeeee.exchange_rate");
  });

  it("keeps the pool the hub named last when it names none later", async () => {
    /** @type {Record<string, unknown>} */
    const replies = {
      [`${HUB}/contract/"pool"`]: NEW_POOL,
      [`${HUB}/contract/"staked-dusk"`]: null,
      [`${HUB}/contract/"substrate"`]: null,
      [`${NEW_POOL}/balance_of/"${ACCOUNT}"`]: "1500000000000",
      [`${NEW_POOL}/exchange_rate/null`]: RATE,
    };
    const node = fakeNode(replies);
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL },
      fetch: node.fetch,
      loadDriver: node.loadDriver,
      nodeUrl: "https://nine.example",
    };

    await readSozuStatus(options);
    replies[`${HUB}/contract/"pool"`] = null;

    // Not the pool known before the hub named another.
    await expect(readSozuStatus(options)).resolves.toMatchObject({
      contracts: { pool: NEW_POOL },
      position: { balance: 1_500_000_000_000n },
    });
  });

  it("uses the pool it knows when the hub names none, and asks the hub again on each refresh", async () => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: null,
      [`${HUB}/contract/"staked-dusk"`]: null,
      [`${HUB}/contract/"substrate"`]: null,
      [`${POOL}/balance_of/"${ACCOUNT}"`]: "0",
      [`${POOL}/exchange_rate/null`]: RATE,
    });
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL },
      fetch: node.fetch,
      loadDriver: node.loadDriver,
      nodeUrl: "https://two.example",
    };

    await expect(readSozuStatus(options)).resolves.toMatchObject({
      contracts: { pool: POOL, stDusk: null },
      fees: null,
      // Without a substrate, neither switch is known.
      flags: { maintenance: null, synchronization: null },
      position: { balance: 0n, stDusk: 0n },
    });
    await readSozuStatus(options);

    expect(
      node.spy.mock.calls.filter(([url]) => String(url).endsWith("/contract"))
    ).toHaveLength(6);
  });

  it("reads from the contracts known before while the hub can't be read", async () => {
    const node = fakeNode({
      [`${POOL}/balance_of/"${ACCOUNT}"`]: "0",
      [`${POOL}/exchange_rate/null`]: RATE,
      [`${SUBSTRATE}/stake_fee_rate/#0`]: TESTNET_FEES.deposit,
      [`${SUBSTRATE}/stake_fee_rate/#1`]: TESTNET_FEES.reward,
      [`${SUBSTRATE}/is_feature_enabled/#0`]: Uint8Array.of(0),
      [`${SUBSTRATE}/is_feature_enabled/#1`]: Uint8Array.of(0),
      [`${TOKEN}/balance_of/"${ACCOUNT}"`]: "0",
    });

    await expect(
      readSozuStatus({
        account: ACCOUNT,
        contracts: {
          hub: HUB,
          pool: POOL,
          stDusk: TOKEN,
          substrate: SUBSTRATE,
        },
        fetch: node.fetch,
        loadDriver: node.loadDriver,
        nodeUrl: "https://seven.example",
      })
    ).resolves.toMatchObject({
      contracts: { pool: POOL, stDusk: TOKEN },
      fees: { deposit: { denominator: 10_000n, numerator: 25n } },
      flags: { maintenance: false, synchronization: false },
    });
  });

  it("keeps each switch on its own: deposits paused stay paused when synchronization can't be read", async () => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: POOL,
      [`${HUB}/contract/"staked-dusk"`]: TOKEN,
      [`${HUB}/contract/"substrate"`]: SUBSTRATE,
      [`${POOL}/balance_of/"${ACCOUNT}"`]: "0",
      [`${POOL}/exchange_rate/null`]: RATE,
      [`${SUBSTRATE}/stake_fee_rate/#0`]: TESTNET_FEES.deposit,
      [`${SUBSTRATE}/stake_fee_rate/#1`]: TESTNET_FEES.reward,
      [`${SUBSTRATE}/is_feature_enabled/#0`]: Uint8Array.of(1),
      [`${TOKEN}/balance_of/"${ACCOUNT}"`]: "0",
    });
    const status = await readSozuStatus({
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL, stDusk: TOKEN, substrate: SUBSTRATE },
      fetch: node.fetch,
      loadDriver: node.loadDriver,
      nodeUrl: "https://eight.example",
    });

    expect(status.flags).toStrictEqual({
      maintenance: true,
      synchronization: null,
    });
    expect(status.fees).not.toBeNull();
  });

  it.each([
    ["nothing", Uint8Array.of()],
    ["a byte other than 0 or 1", Uint8Array.of(2)],
    ["more than one byte", Uint8Array.of(0, 0)],
  ])("doesn't read a switch answered with %s as off", async (_what, answer) => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: POOL,
      [`${HUB}/contract/"staked-dusk"`]: TOKEN,
      [`${HUB}/contract/"substrate"`]: SUBSTRATE,
      [`${POOL}/balance_of/"${ACCOUNT}"`]: "0",
      [`${POOL}/exchange_rate/null`]: RATE,
      [`${SUBSTRATE}/stake_fee_rate/#0`]: TESTNET_FEES.deposit,
      [`${SUBSTRATE}/stake_fee_rate/#1`]: TESTNET_FEES.reward,
      [`${SUBSTRATE}/is_feature_enabled/#0`]: answer,
      [`${SUBSTRATE}/is_feature_enabled/#1`]: Uint8Array.of(0),
      [`${TOKEN}/balance_of/"${ACCOUNT}"`]: "0",
    });
    const status = await readSozuStatus({
      account: ACCOUNT,
      contracts: {
        hub: HUB,
        pool: POOL,
        stDusk: TOKEN,
        substrate: SUBSTRATE,
      },
      fetch: node.fetch,
      loadDriver: node.loadDriver,
      nodeUrl: "https://ten.example",
    });

    expect(status.flags).toStrictEqual({
      maintenance: null,
      synchronization: false,
    });
  });

  it("fails when the pool can't be read, and asks the hub again next time", async () => {
    const node = fakeNode({});
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL },
      fetch: node.fetch,
      loadDriver: node.loadDriver,
      nodeUrl: "https://three.example",
    };

    await expect(readSozuStatus(options)).rejects.toThrow(
      "Sozu's exchange_rate read failed: 500"
    );
    await expect(readSozuStatus(options)).rejects.toThrow();
    // The hub's three names and the pool's two figures, each time.
    expect(node.spy).toHaveBeenCalledTimes(10);
  });
});
