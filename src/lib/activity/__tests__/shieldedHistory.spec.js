import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recorded from "./fixtures/phoenix-testnet.json";
import { LEAF_BYTES } from "../phoenixHistory";

const NODE = "https://testnet.nodes.dusk.network";
const ADDRESS = "the-profile's-shielded-address";
const DUSK = 1_000_000_000n;

/** @param {string} hex */
const bytes = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {string} hex */
const leavesOf = (hex) => {
  const all = bytes(hex);

  return Array.from({ length: all.length / LEAF_BYTES }, (_, i) =>
    all.slice(i * LEAF_BYTES, (i + 1) * LEAF_BYTES)
  );
};

// The note tree's first six leaves, and leaves 492 to 495: the unshield at
// 3602438 made 493 and 494, the shield at 3861643 made 495.
const FIRST = leavesOf(recorded.firstLeaves);
const [, L493, L494, L495] = leavesOf(recorded.leaves492);

const profile = /** @type {Profile} */ (
  /** @type {unknown} */ ({ address: { toString: () => ADDRESS } })
);

/** A node with a note tree of the first six leaves. */
function fakeNetwork() {
  const size = new Uint8Array(8);

  new DataView(size.buffer).setBigUint64(0, BigInt(FIRST.length), true);

  const call = {
    // eslint-disable-next-line camelcase
    leaves_from_pos: vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              FIRST.forEach((leaf) => controller.enqueue(leaf));
              controller.close();
            },
          })
        )
    ),
    // eslint-disable-next-line camelcase
    num_notes: vi.fn(async () => new Response(size)),
  };

  return { call, network: { contracts: { transferContract: { call } } } };
}

/** @type {typeof import("../shieldedHistory")} */
let shieldedHistory;

/** @type {string[]} */
let queries;

beforeEach(async () => {
  vi.resetModules();

  const store = await import("../activityStore");

  await store.activityDatabase.delete({ disableAutoOpen: false });
  shieldedHistory = await import("../shieldedHistory");

  queries = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (/** @type {any} */ url, /** @type {any} */ init) => {
      queries.push(String(init.body));

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(recorded.blocks),
      };
    })
  );

  // The modules the history uses, as it imports them.
  const { default: walletCache } = await import("$lib/wallet-cache");
  const { Bookkeeper } = await import("@dusk/w3sper");

  // The profile's notes: the unshield's outputs and the shield's note.
  vi.spyOn(walletCache, "getUnspentNotes").mockResolvedValue(
    [L493, L494, L495].map((leaf, i) => ({
      address: ADDRESS,
      note: /** @type {Uint8Array<ArrayBuffer>} */ (leaf),
      nullifier: new Uint8Array(32).fill(i + 1),
    }))
  );
  vi.spyOn(walletCache, "getSpentNotes").mockResolvedValue([]);

  // Their values, from the profile's keys, in that order.
  vi.spyOn(Bookkeeper.prototype, "balance")
    .mockResolvedValueOnce({ spendable: DUSK, value: DUSK })
    .mockResolvedValueOnce({ spendable: 12_000_000n, value: 12_000_000n })
    .mockResolvedValueOnce({ spendable: 2n * DUSK, value: 2n * DUSK });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getShieldedHistory", () => {
  it("works the history out from the cached notes once they're synced, asking for their blocks among others, and keeps it", async () => {
    const { call, network } = fakeNetwork();
    const options = {
      isCurrent: () => true,
      network: async () => network,
      nodeUrl: NODE,
      profile,
      synced: true,
    };

    const first = await shieldedHistory.getShieldedHistory(options);

    expect(first.entries).toEqual([
      expect.objectContaining({
        amount: String(2n * DUSK),
        blockHeight: 3861643,
        direction: "in",
        kind: "shield",
        privacy: "shielded",
      }),
      // The unshield's outputs: received, as the profile spent nothing.
      expect.objectContaining({
        amount: "1012000000",
        blockHeight: 3602438,
        direction: "in",
        hash: "3b0c1b4bcc517e91bf63525f232689452b6b51e46ccb1a5be4f8a0af73ddac11",
      }),
    ]);

    // The note tree was read once, from the first note.
    expect(call.num_notes).toHaveBeenCalledTimes(1);
    expect(call.leaves_from_pos).toHaveBeenCalledTimes(1);

    // The notes' two heights, each among the tree's other heights.
    const asked = [...queries.join(" ").matchAll(/b(\d+): block/g)].map((m) =>
      Number(m[1])
    );

    expect(asked).toEqual(expect.arrayContaining([3602438, 3861643]));
    expect(asked.length).toBeGreaterThan(2);
    expect(
      asked
        .filter((h) => h !== 3602438 && h !== 3861643)
        .every((h) => [184423, 226951, 234329, 234369].includes(h))
    ).toBe(true);

    // The same notes again: the kept history, without asking anything.
    const again = await shieldedHistory.getShieldedHistory(options);

    expect(again.entries).toEqual(first.entries);
    expect(queries).toHaveLength(1);
  });

  it("waits for the shielded sync before working anything out", async () => {
    const { call, network } = fakeNetwork();

    await expect(
      shieldedHistory.getShieldedHistory({
        isCurrent: () => true,
        network: async () => network,
        nodeUrl: NODE,
        profile,
        synced: false,
      })
    ).resolves.toEqual({ entries: [], pending: true });
    expect(call.leaves_from_pos).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("keeps nothing when the wallet changed while it was worked out", async () => {
    const { network } = fakeNetwork();
    let current = true;
    const options = {
      isCurrent: () => current,
      network: async () => {
        current = false;

        return network;
      },
      nodeUrl: NODE,
      profile,
      synced: true,
    };

    await expect(shieldedHistory.getShieldedHistory(options)).rejects.toThrow(
      "The wallet changed while its shielded history was read"
    );

    const { getShieldedHistoryRecord } = await import("../activityStore");

    expect(await getShieldedHistoryRecord(`testnet::${ADDRESS}`)).toBeNull();
  });
});
