import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataDrivers } from "@dusk/w3sper";

import block from "./fixtures/stake-block-testnet.json";

const NODE = "https://testnet.nodes.dusk.network";

/** The pool's driver, as the wallet bundles it. */
async function poolDriver() {
  const bytes = await readFile(
    resolve(process.cwd(), "static/drivers/sozu_pool_data_driver.wasm")
  );
  const driver = await dataDrivers.load(new Uint8Array(bytes));

  driver.init();

  return driver;
}

/**
 * A node answering the block's events.
 *
 * @param {any[]} events
 */
function node(events) {
  /** @type {import("vitest").Mock<typeof globalThis.fetch>} */
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ contractEvents: { json: events } }), {
        headers: { "Content-Type": "application/json" },
      })
  );

  vi.stubGlobal("fetch", fetch);

  return fetch;
}

/** @type {typeof import("../received").stDuskReceived} */
let stDuskReceived;

beforeEach(async () => {
  // Each test starts without what was read before.
  vi.resetModules();
  ({ stDuskReceived } = await import("../received"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stDuskReceived", () => {
  const stake = {
    blockHeight: block.blockHeight,
    contractId: block.pool,
    hash: block.hash,
  };

  it("should read what a stake got from the pool's deposit event in its block, once", async () => {
    const fetch = node(block.events);
    const driver = await poolDriver();
    const options = { driver: async () => driver };

    await expect(stDuskReceived(NODE, stake, options)).resolves.toBe(
      BigInt(block.minted)
    );
    await expect(
      stDuskReceived(
        NODE,
        { ...stake, hash: `0x${block.hash.toUpperCase()}` },
        options
      )
    ).resolves.toBe(BigInt(block.minted));

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][1]?.body)).toContain(
      `contractEvents(height: ${block.blockHeight})`
    );
  });

  it("should read nothing for another transaction or pool, a reverted event, or a stake it can't place", async () => {
    const driver = await poolDriver();
    const options = { driver: async () => driver };
    const pool = block.events.find((e) => e.source === block.pool);

    node(block.events);

    // The transfer contract's own deposit event, in the same transaction,
    // isn't the pool's.
    await expect(
      stDuskReceived(
        NODE,
        { ...stake, contractId: "01".padEnd(64, "0") },
        options
      )
    ).resolves.toBeNull();
    await expect(
      stDuskReceived(NODE, { ...stake, hash: "ab".repeat(32) }, options)
    ).resolves.toBeNull();

    node([{ ...pool, reverted: true }]);

    await expect(stDuskReceived(NODE, stake, options)).resolves.toBeNull();

    const fetch = node(block.events);

    for (const bad of [
      { ...stake, blockHeight: undefined },
      { ...stake, blockHeight: -1 },
      { ...stake, contractId: "" },
      { ...stake, hash: "not a hash" },
    ]) {
      await expect(stDuskReceived(NODE, bad, options)).resolves.toBeNull();
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it("should read it again after a failed read", async () => {
    const driver = await poolDriver();
    const options = { driver: async () => driver };
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    vi.stubGlobal("fetch", failing);

    await expect(stDuskReceived(NODE, stake, options)).resolves.toBeNull();

    node(block.events);

    await expect(stDuskReceived(NODE, stake, options)).resolves.toBe(
      BigInt(block.minted)
    );
  });
});
