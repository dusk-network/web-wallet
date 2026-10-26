import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataDrivers } from "@dusk/w3sper";

import {
  SOZU_FN,
  duskPerStDusk,
  encodeU64,
  isSozuCall,
  parsePool,
  readSozuStatus,
  sozuContractsFor,
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
  it("has a hub and a pool on mainnet and testnet only", () => {
    expect(sozuContractsFor("testnet")).toStrictEqual({ hub: HUB, pool: POOL });
    expect(sozuContractsFor("mainnet")?.pool).toMatch(/^[0-9a-f]{64}$/);
    expect(sozuContractsFor("devnet")).toBeNull();
    expect(sozuContractsFor("toString")).toBeNull();
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

describe("readSozuStatus", () => {
  /**
   * Drivers that read JSON and answer JSON, and a node that answers each
   * read from `replies`.
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
      const key = `${id}/${fn}/${decoder.decode(init.body)}`;

      return key in replies
        ? new Response(JSON.stringify(replies[key]))
        : new Response("Unknown", { status: 500 });
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

  it("reads the pool and the stDUSK token the hub names, and the account's balances there", async () => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: NEW_POOL,
      [`${HUB}/contract/"staked-dusk"`]: TOKEN,
      [`${NEW_POOL}/balance_of/"${ACCOUNT}"`]: "1500000000000",
      [`${NEW_POOL}/exchange_rate/null`]: RATE,
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
      pool: parsePool(RATE),
      position: { balance: 1_500_000_000_000n, stDusk: 487_000_000_000n },
    });
    expect(node.spy.mock.calls.map(([url]) => url)).toStrictEqual([
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${HUB}/contract`,
      `https://one.example/on/contracts:${NEW_POOL}/exchange_rate`,
      `https://one.example/on/contracts:${NEW_POOL}/balance_of`,
      `https://one.example/on/contracts:${TOKEN}/balance_of`,
    ]);
  });

  it("uses the pool it knows when the hub names none, and asks the hub once a node", async () => {
    const node = fakeNode({
      [`${HUB}/contract/"pool"`]: null,
      [`${HUB}/contract/"staked-dusk"`]: null,
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
      position: { balance: 0n, stDusk: 0n },
    });
    await readSozuStatus(options);

    expect(
      node.spy.mock.calls.filter(([url]) => String(url).endsWith("/contract"))
    ).toHaveLength(2);
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
    expect(node.spy).toHaveBeenCalledTimes(4);
  });
});
