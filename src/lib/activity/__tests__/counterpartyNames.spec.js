import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBase58 } from "@duskdomains/sdk";

import releases from "$lib/dusk-domains/dusk-domains-releases.json";
import recorded from "./fixtures/multicall-testnet.json";

const mocks = vi.hoisted(() => ({
  createLensReader: vi.fn(),
  getLensReader: vi.fn(),
}));

vi.mock("@duskdomains/sdk/lens-reader", () => ({
  createLensReader: mocks.createLensReader,
}));

vi.mock("$lib/dusk-domains/getLensReader", () => ({
  default: mocks.getLensReader,
}));

const NODE = "https://testnet.nodes.dusk.network";
const [NAMED, UNNAMED] = recorded.accounts;
const SHIELDED_ADDRESS =
  "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG";
const LENS = releases.testnet.lens.contractId;

/** @param {string} spelling */
const primary = (spelling) => ({ primary: { spelling } });

/**
 * @param {readonly number[] | Uint8Array} key
 * @param {string} account
 */
const isKeyOf = (key, account) =>
  Array.from(key).join() === Array.from(decodeBase58(account) ?? []).join();

/** @type {typeof import("../counterpartyNames")} */
let names;

beforeEach(async () => {
  // The batched readers are kept per network: new modules, new readers.
  vi.resetModules();
  names = await import("../counterpartyNames");
});

afterEach(() => {
  mocks.createLensReader.mockReset();
  mocks.getLensReader.mockReset();
  vi.unstubAllGlobals();
});

/**
 * A lens reader answering `verifyPrimary` with `answer`.
 *
 * @param {(key: readonly number[] | Uint8Array) => Promise<any>} answer
 */
function useReader(answer) {
  const reader = { verifyPrimary: vi.fn(answer) };

  mocks.createLensReader.mockResolvedValue(reader);

  return reader;
}

describe("lookupCounterpartyNames", () => {
  it("looks up the public accounts among them at once, each once, with null for an account without a name", async () => {
    const reader = useReader(async (key) =>
      isKeyOf(key, NAMED) ? primary("shpongle.dusk") : null
    );
    const result = await names.lookupCounterpartyNames(
      [NAMED, UNNAMED, ` ${NAMED} `, SHIELDED_ADDRESS, "carol.dusk"],
      { network: "testnet", nodeUrl: NODE }
    );

    expect(result).toEqual(
      new Map([
        [NAMED, "shpongle.dusk"],
        [UNNAMED, null],
      ])
    );
    expect(reader.verifyPrimary).toHaveBeenCalledTimes(2);
    expect(mocks.createLensReader).toHaveBeenCalledWith(releases.testnet, {
      artifactBaseUrl: releases.testnet.artifactBaseUrl,
      fetch: expect.any(Function),
      nodeUrl: NODE,
    });
  });

  it("sends the reads the reader makes in one task through Multicall for Dusk, as one query", async () => {
    useReader(async () => null);
    await names.lookupCounterpartyNames([NAMED], {
      network: "testnet",
      nodeUrl: NODE,
    });

    const { fetch: batched } = mocks.createLensReader.mock.calls[0][1];

    /** @type {[string, Uint8Array][]} */
    const sent = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (/** @type {any} */ url, /** @type {any} */ init) => {
        sent.push([String(url), new Uint8Array(init.body)]);

        // Two results of one byte each, as the multicall archives them: the
        // bytes, a 16-byte slot each from 4, and the root at 40.
        const reply = new Uint8Array(56);
        const view = new DataView(reply.buffer);

        reply.set([7, 8], 0);
        view.setInt32(4 + 4, 0 - (4 + 4), true);
        view.setUint32(4 + 8, 1, true);
        view.setInt32(20 + 4, 1 - (20 + 4), true);
        view.setUint32(20 + 8, 1, true);
        view.setBigUint64(40, 5n, true);
        view.setInt32(48, 4 - 48, true);
        view.setUint32(52, 2, true);

        return new Response(reply);
      })
    );

    /** @param {number[]} body */
    const read = (body) =>
      batched(`${NODE}/on/contracts:${LENS}/reverse`, {
        body: new Uint8Array(body),
        method: "POST",
      });
    const answers = await Promise.all([read([1]), read([2])]);

    expect(sent.map(([url]) => url)).toEqual([
      `${NODE}/on/contracts:93de287b7d349d678a0038fe7772e8960e1a84a1b5da2d0b1f62f532616ce1d4/aggregate`,
    ]);
    expect(
      await Promise.all(
        answers.map(async (res) =>
          Array.from(new Uint8Array(await res.arrayBuffer()))
        )
      )
    ).toEqual([[7], [8]]);

    // Each reverse read capped at the SDK client's 842M gas: 203 reads at 4M, and 30M.
    const envelope = sent[0][1];
    const view = new DataView(envelope.buffer);
    const calls = view.getUint32(envelope.length - 4, true);
    const array =
      envelope.length - 8 + view.getInt32(envelope.length - 8, true);

    expect(calls).toBe(2);
    expect(view.getBigUint64(array + 48, true)).toBe(842_000_000n);
  });

  it("leaves out a name too long to show whole, or one that reads like an account", async () => {
    useReader(async (key) =>
      isKeyOf(key, NAMED)
        ? primary("a-very-long-name-that-runs-on.dusk")
        : primary("abc123def456ghi789.dusk")
    );

    await expect(
      names.lookupCounterpartyNames([NAMED, UNNAMED], {
        network: "testnet",
        nodeUrl: NODE,
      })
    ).resolves.toEqual(
      new Map([
        [NAMED, null],
        [UNNAMED, null],
      ])
    );
  });

  it("reads a name the batch was short of gas for again on its own", async () => {
    useReader(async (key) => {
      if (isKeyOf(key, UNNAMED)) {
        throw Object.assign(new Error("refused"), {
          reason: "refused",
          refusal: { code: "GasBudget" },
        });
      }

      return null;
    });
    mocks.getLensReader.mockResolvedValue({
      verifyPrimary: async () => primary("noor.dusk"),
    });

    await expect(
      names.lookupCounterpartyNames([NAMED, UNNAMED], {
        network: "testnet",
        nodeUrl: NODE,
      })
    ).resolves.toEqual(
      new Map([
        [NAMED, null],
        [UNNAMED, "noor.dusk"],
      ])
    );
    expect(mocks.getLensReader).toHaveBeenCalledWith("testnet", NODE);
  });

  it("leaves out an account whose lookup failed, and never throws", async () => {
    useReader(async (key) => {
      if (isKeyOf(key, NAMED)) {
        throw new Error("node unreachable");
      }

      return null;
    });

    await expect(
      names.lookupCounterpartyNames([NAMED, UNNAMED], {
        network: "testnet",
        nodeUrl: NODE,
      })
    ).resolves.toEqual(new Map([[UNNAMED, null]]));

    mocks.createLensReader.mockRejectedValue(new Error("no driver"));
    vi.resetModules();
    names = await import("../counterpartyNames");

    await expect(
      names.lookupCounterpartyNames([NAMED], {
        network: "testnet",
        nodeUrl: NODE,
      })
    ).resolves.toEqual(new Map());
  });

  it("looks up nothing off Mainnet and Testnet", async () => {
    await expect(
      names.lookupCounterpartyNames([NAMED], {
        network: "devnet",
        nodeUrl: NODE,
      })
    ).resolves.toEqual(new Map());
    expect(mocks.createLensReader).not.toHaveBeenCalled();
  });
});
