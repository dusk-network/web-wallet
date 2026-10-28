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
  stDuskFor,
} from "..";
import { sozuCall } from "../calls";

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
    expect(stDuskFor(1n, parsePool({}))).toBeNull();
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

describe("Sozu's contracts", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("has a hub and a pool on mainnet and testnet only", () => {
    expect(sozuContractsFor("testnet")).toStrictEqual({ hub: HUB, pool: POOL });
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

  it("reads the pool and the stDUSK token the hub names, and the account's balances there", async () => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: NEW_POOL,
      [`${HUB}/contract/"staked-dusk"`]: TOKEN,
      [`${HUB}/contract/"substrate"`]: SUBSTRATE,
      [`${NEW_POOL}/balance_of/"${ACCOUNT}"`]: "1500000000000",
      [`${NEW_POOL}/exchange_rate/null`]: RATE,
      [`${SUBSTRATE}/stake_fee_rate/#0`]: MAINNET_FEES.deposit,
      [`${SUBSTRATE}/stake_fee_rate/#1`]: MAINNET_FEES.reward,
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
      pool: parsePool(RATE),
      position: { balance: 1_500_000_000_000n, stDusk: 487_000_000_000n },
    });
    // The history names the calls of the pool the hub named.
    expect(isSozuCall({ contractId: NEW_POOL, fnName: "sozu_stake" })).toBe(
      true
    );
    expect(node.spy.mock.calls.map(([url]) => url)).toStrictEqual([
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${NEW_POOL}/exchange_rate`,
      `https://one.example/on/contracts:${NEW_POOL}/balance_of`,
      `https://one.example/on/contracts:${TOKEN}/balance_of`,
      `https://one.example/on/contracts:${SUBSTRATE}/stake_fee_rate`,
      `https://one.example/on/contracts:${SUBSTRATE}/stake_fee_rate`,
    ]);
  });

  it("reads the fees with the pool's figures, in one Multicall for Dusk query, and once a node", async () => {
    const encoder = new TextEncoder();
    const rate = encoder.encode(JSON.stringify(RATE));
    const noBalance = encoder.encode(JSON.stringify("0"));
    /** @type {number[]} */
    const sizes = [];
    const base = vi.fn(async (/** @type {string} */ _url, init) => {
      const body = new Uint8Array(init.body);
      const n = new DataView(body.buffer, body.byteOffset).getUint32(
        body.length - 4,
        true
      );

      sizes.push(n);

      // The hub's three names, then the pool's figures with both fees.
      return new Response(
        n === 3
          ? multicallReply(
              [POOL, null, SUBSTRATE].map((id) =>
                encoder.encode(JSON.stringify(id))
              )
            )
          : multicallReply([
              rate,
              noBalance,
              // The fees only until they're kept.
              ...(n === 4 ? [TESTNET_FEES.deposit, TESTNET_FEES.reward] : []),
            ])
      );
    });
    const decoder = new TextDecoder();
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL },
      fetch: createMulticallFetch({
        fetch: /** @type {typeof globalThis.fetch} */ (
          /** @type {unknown} */ (base)
        ),
        nodeUrl: "https://five.example",
      }),
      loadDriver: async () =>
        /** @type {SozuDriver} */ ({
          decodeOutputFn: (_fn, bytes) => JSON.parse(decoder.decode(bytes)),
          encodeInputFn: (_fn, json) => encoder.encode(json),
        }),
      nodeUrl: "https://five.example",
    };

    // The rates follow the contract: testnet's reward fee is 10%, not mainnet's 15%.
    await expect(readSozuStatus(options)).resolves.toMatchObject({
      fees: {
        deposit: { denominator: 10_000n, numerator: 25n },
        reward: { denominator: 100n, numerator: 10n },
      },
    });
    expect(sizes).toStrictEqual([3, 4]);

    // Kept for this node, like the contracts the hub names: not read again.
    await expect(readSozuStatus(options)).resolves.toMatchObject({
      fees: { reward: { numerator: 10n } },
    });
    expect(sizes).toStrictEqual([3, 4, 2]);
  });

  it("uses the pool it knows when the hub names none, and asks the hub once a node", async () => {
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
      position: { balance: 0n, stDusk: 0n },
    });
    await readSozuStatus(options);

    expect(
      node.spy.mock.calls.filter(([url]) => String(url).endsWith("/contract"))
    ).toHaveLength(3);
  });

  it("fails when a read fails, and asks the hub again next time", async () => {
    const node = fakeNode({});
    const options = {
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL },
      fetch: node.fetch,
      loadDriver: node.loadDriver,
      nodeUrl: "https://three.example",
    };

    await expect(readSozuStatus(options)).rejects.toThrow(
      "Sozu's contract read failed: 500"
    );
    await expect(readSozuStatus(options)).rejects.toThrow();
    expect(node.spy).toHaveBeenCalledTimes(6);
  });
});
