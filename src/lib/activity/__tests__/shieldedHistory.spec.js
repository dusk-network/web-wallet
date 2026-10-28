import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recorded from "./fixtures/phoenix-testnet.json";
import {
  LEAF_BYTES,
  LEAF_HEIGHT_OFFSET,
  LEAF_POS_OFFSET,
} from "../phoenixHistory";

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
const [L492, L493, L494, L495] = leavesOf(recorded.leaves492);

// The tree up to leaf 495: leaves 6 to 491 made up, all at one height
// between.
const GROWN = 300_000;
const TREE = [
  ...FIRST,
  ...Array.from({ length: 486 }, (_, i) => {
    const leaf = FIRST[5].slice();
    const view = new DataView(leaf.buffer);

    view.setBigUint64(LEAF_POS_OFFSET, BigInt(6 + i), true);
    view.setBigUint64(LEAF_HEIGHT_OFFSET, BigInt(GROWN), true);

    return leaf;
  }),
  L492,
  L493,
  L494,
  L495,
];

/** @param {Uint8Array} at A position as the node takes it */
const position = (at) =>
  new DataView(at.buffer, at.byteOffset).getBigUint64(0, true);

const profile = /** @type {Profile} */ (
  /** @type {unknown} */ ({ address: { toString: () => ADDRESS } })
);

/**
 * A node with a note tree, which streams its leaves from the position asked.
 *
 * @param {Uint8Array[]} [leaves]
 */
function fakeNetwork(leaves = TREE) {
  const tree = { leaves };
  const call = {
    // eslint-disable-next-line camelcase
    leaves_from_pos: vi.fn(
      async (/** @type {Uint8Array} */ from) =>
        new Response(
          new ReadableStream({
            start(controller) {
              tree.leaves
                .slice(Number(position(from)))
                .forEach((leaf) => controller.enqueue(leaf));
              controller.close();
            },
          })
        )
    ),
    // eslint-disable-next-line camelcase
    num_notes: vi.fn(async () => {
      const size = new Uint8Array(8);

      new DataView(size.buffer).setBigUint64(
        0,
        BigInt(tree.leaves.length),
        true
      );

      return new Response(size);
    }),
  };

  return { call, network: { contracts: { transferContract: { call } } }, tree };
}

/** The notes' values, from the profile's keys, in their order. */
async function valueNotes() {
  const { Bookkeeper } = await import("@dusk/w3sper");

  vi.mocked(Bookkeeper.prototype.balance)
    .mockResolvedValueOnce({ spendable: DUSK, value: DUSK })
    .mockResolvedValueOnce({ spendable: 12_000_000n, value: 12_000_000n })
    .mockResolvedValueOnce({ spendable: 2n * DUSK, value: 2n * DUSK });
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
  // On a testnet node: the recordings' network.
  (await import("$lib/stores/nodeNetwork")).setNodeNetwork(
    (await import("@dusk-network/networks")).networks.testnet
  );

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

  vi.spyOn(Bookkeeper.prototype, "balance");
  await valueNotes();
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
        .every((h) =>
          [184423, 226951, 234329, 234369, GROWN, 3577762].includes(h)
        )
    ).toBe(true);

    // The same notes again: the kept history, without asking anything.
    const again = await shieldedHistory.getShieldedHistory(options);

    expect(again.entries).toEqual(first.entries);
    expect(queries).toHaveLength(1);
  });

  it("asks nothing for a note at a height the tree it read doesn't have, and reads only the leaves added since", async () => {
    const { call, network, tree } = fakeNetwork(FIRST);
    const options = {
      isCurrent: () => true,
      network: async () => network,
      nodeUrl: NODE,
      profile,
      synced: true,
    };

    // Six leaves: the notes' heights aren't among the tree's, so no decoy
    // could be one, and nothing is asked.
    await expect(shieldedHistory.getShieldedHistory(options)).resolves.toEqual({
      entries: [],
      pending: true,
    });
    expect(queries).toEqual([]);

    // The tree grew: its heights are extended with the leaves added since.
    tree.leaves = TREE;
    await valueNotes();

    const grown = await shieldedHistory.getShieldedHistory(options);

    expect(grown.entries).toHaveLength(2);
    expect(queries).toHaveLength(1);
    expect(call.leaves_from_pos).toHaveBeenCalledTimes(2);
    expect(position(call.leaves_from_pos.mock.calls[1][0])).toBe(6n);

    const { getNoteHeightPool } = await import("../activityStore");

    expect(await getNoteHeightPool("testnet")).toMatchObject({ notes: 496 });
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

  it("marks a kept or an empty history pending while the notes sync", async () => {
    const { network } = fakeNetwork();
    const options = {
      isCurrent: () => true,
      network: async () => network,
      nodeUrl: NODE,
      profile,
      synced: true,
    };
    const { entries } = await shieldedHistory.getShieldedHistory(options);

    // The same notes, kept: while a sync runs, more can come.
    await expect(
      shieldedHistory.getShieldedHistory({ ...options, synced: false })
    ).resolves.toEqual({ entries, pending: true });

    // No notes yet.
    const { default: walletCache } = await import("$lib/wallet-cache");

    vi.mocked(walletCache.getUnspentNotes).mockResolvedValue([]);

    await expect(
      shieldedHistory.getShieldedHistory({ ...options, synced: false })
    ).resolves.toEqual({ entries: [], pending: true });
    await expect(shieldedHistory.getShieldedHistory(options)).resolves.toEqual({
      entries: [],
    });
  });

  it("asks nothing without a decoy to ask among: the heights would be the profile's own", async () => {
    // A tree whose only heights are the notes': leaves 0 to 492 made up at
    // the unshield's height.
    const { network } = fakeNetwork([
      ...Array.from({ length: 493 }, (_, i) => {
        const leaf = FIRST[5].slice();
        const view = new DataView(leaf.buffer);

        view.setBigUint64(LEAF_POS_OFFSET, BigInt(i), true);
        view.setBigUint64(LEAF_HEIGHT_OFFSET, 3_602_438n, true);

        return leaf;
      }),
      L493,
      L494,
      L495,
    ]);

    await expect(
      shieldedHistory.getShieldedHistory({
        isCurrent: () => true,
        network: async () => network,
        nodeUrl: NODE,
        profile,
        synced: true,
      })
    ).resolves.toEqual({ entries: [], pending: true });
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
