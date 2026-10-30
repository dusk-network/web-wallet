import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEAF_BYTES,
  LEAF_HEIGHT_OFFSET,
  LEAF_POS_OFFSET,
} from "@dusk-network/app-core/shielded";

import recorded from "./fixtures/phoenix-testnet.json";

const NODE = "https://testnet.nodes.dusk.network";
const ADDRESS = "the-profile's-shielded-address";
const KEY = `testnet::${ADDRESS}`;
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

// The profile's rows, as History keeps them: the shield's note, and the
// unshield's outputs, received.
/** @type {KeptShieldedRow[]} */
const ROWS = [
  {
    amount: String(2n * DUSK),
    blockHeight: 3861643,
    direction: "in",
    error: undefined,
    feePaid: undefined,
    hash: "a2e97cf890fb6d4e7dd13ee6d24765e86ea4985e5788eaf06dbe2a287cc77646",
    kind: "shield",
    privacy: "shielded",
    source: "shielded",
    status: "executed",
    timestamp: 1_784_723_688_000,
  },
  {
    amount: "1012000000",
    blockHeight: 3602438,
    direction: "in",
    error: undefined,
    feePaid: undefined,
    hash: "3b0c1b4bcc517e91bf63525f232689452b6b51e46ccb1a5be4f8a0af73ddac11",
    kind: "shield",
    privacy: "shielded",
    source: "shielded",
    status: "executed",
    timestamp: 1_782_131_528_000,
  },
];

/** The same, as the history gives them. */
const ENTRIES = ROWS.map(
  ({ amount, blockHeight, direction, hash, kind, timestamp }) => ({
    blockHeight,
    direction,
    fee: null,
    hash,
    kind,
    success: true,
    timestamp,
    value: amount,
  })
);

const profile = /** @type {Profile} */ (
  /** @type {unknown} */ ({ address: { toString: () => ADDRESS } })
);

/**
 * A node with a note tree, which streams its leaves from the position asked.
 *
 * @param {Uint8Array[]} [leaves]
 */
function fakeNetwork(leaves = TREE) {
  /** @param {Uint8Array} at A position as the node takes it */
  const position = (at) =>
    new DataView(at.buffer, at.byteOffset).getBigUint64(0, true);
  const call = {
    // eslint-disable-next-line camelcase
    leaves_from_pos: vi.fn(
      async (/** @type {Uint8Array} */ from) =>
        new Response(
          new ReadableStream({
            start(controller) {
              leaves
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

      new DataView(size.buffer).setBigUint64(0, BigInt(leaves.length), true);

      return new Response(size);
    }),
  };

  return { call, network: { contracts: { transferContract: { call } } } };
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

/** @type {typeof import("../activityStore")} */
let store;

/** @type {string[]} */
let queries;

/** @type {(() => Promise<void>) | null} */
let beforeAnswer;

/** The heights the archive was asked for. */
const heightsAsked = () =>
  [...queries.join(" ").matchAll(/b(\d+): block/g)].map((m) => Number(m[1]));

/** @param {Partial<import("../shieldedHistory").ShieldedHistoryOptions>} [options] */
const read = async (options) =>
  shieldedHistory.getShieldedHistory({
    isCurrent: () => true,
    network: async () => fakeNetwork().network,
    nodeUrl: NODE,
    profile,
    synced: true,
    ...options,
  });

beforeEach(async () => {
  vi.resetModules();

  store = await import("../activityStore");
  await store.activityDatabase.delete({ disableAutoOpen: false });
  shieldedHistory = await import("../shieldedHistory");
  // On a testnet node: the recordings' network.
  (await import("$lib/stores/nodeNetwork")).setNodeNetwork(
    (await import("@dusk-network/networks")).networks.testnet
  );

  queries = [];
  beforeAnswer = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (/** @type {any} */ url, /** @type {any} */ init) => {
      queries.push(String(init.body));
      await beforeAnswer?.();

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
  it("works the history out from the cached notes, asking for their blocks among others, keeps it as History's rows, and reads it back asking nothing", async () => {
    const { call, network } = fakeNetwork();
    const options = { network: async () => network };

    await expect(read(options)).resolves.toEqual({ entries: ENTRIES });

    // The notes' two heights, each among the tree's other heights.
    const asked = heightsAsked();

    expect(asked).toEqual(expect.arrayContaining([3602438, 3861643]));
    expect(asked.length).toBeGreaterThan(2);
    expect(
      asked
        .filter((h) => h !== 3602438 && h !== 3861643)
        .every((h) =>
          [184423, 226951, 234329, 234369, GROWN, 3577762].includes(h)
        )
    ).toBe(true);

    // Kept as the rows History shows, with the decoys and the tree's heights.
    expect(await store.getShieldedHistoryRecord(KEY)).toEqual({
      at: expect.any(Number),
      decoys: expect.any(Array),
      entries: ROWS,
      fingerprint: "493,494,495",
      ownerKey: KEY,
    });
    expect(await store.getNoteHeightPool("testnet")).toMatchObject({
      network: "testnet",
      notes: 496,
    });

    // The same notes again: the kept rows, without asking anything.
    await expect(read(options)).resolves.toEqual({ entries: ENTRIES });

    // Rows kept before for the same notes read back as the entries they
    // were: a failed send with its error and fee, and one to the profile
    // itself.
    /** @type {KeptShieldedRow[]} */
    const kept = [
      {
        ...ROWS[0],
        amount: "500000000",
        direction: "out",
        error: "Panic: out of gas",
        feePaid: "2000000",
        hash: "ab".repeat(32),
        kind: "transfer",
        status: "failed",
      },
      { ...ROWS[1], amount: undefined, direction: "self", feePaid: "1000" },
    ];

    await store.putShieldedHistoryRecord(KEY, {
      decoys: [GROWN],
      entries: kept,
      fingerprint: "493,494,495",
    });
    await expect(read(options)).resolves.toEqual({
      entries: [
        {
          ...ENTRIES[0],
          direction: "out",
          error: "Panic: out of gas",
          fee: "2000000",
          hash: "ab".repeat(32),
          kind: "transfer",
          success: false,
          value: "500000000",
        },
        { ...ENTRIES[1], direction: "self", fee: "1000", value: "0" },
      ],
    });
    expect(queries).toHaveLength(1);
    expect(call.num_notes).toHaveBeenCalledTimes(1);
    expect(call.leaves_from_pos).toHaveBeenCalledTimes(1);
  });

  it("shows a history this browser couldn't keep, and keeps nothing of one a reset overtook", async () => {
    const keep = store.putShieldedHistoryRecord;
    const put = vi
      .spyOn(store, "putShieldedHistoryRecord")
      .mockImplementation(async (key, record, epoch) => {
        if (record.entries.length) {
          throw new DOMException("The store is full", "QuotaExceededError");
        }

        return keep(key, record, epoch);
      });

    await expect(read()).resolves.toEqual({ entries: ENTRIES });
    expect((await store.getShieldedHistoryRecord(KEY))?.entries ?? []).toEqual(
      []
    );

    put.mockRestore();

    // The wallet is reset while the blocks are asked for.
    beforeAnswer = () => store.clearActivityStore();
    await valueNotes();

    await expect(read()).rejects.toThrow(store.StaleActivityError);
    expect(await store.getShieldedHistoryRecord(KEY)).toBeNull();
  });

  it("keeps nothing when another profile is shown while it is worked out", async () => {
    let shown = profile;

    beforeAnswer = async () => {
      shown = /** @type {Profile} */ (/** @type {unknown} */ ({}));
    };

    await expect(read({ isCurrent: () => shown === profile })).rejects.toThrow(
      "The wallet changed while its shielded history was read"
    );
    expect((await store.getShieldedHistoryRecord(KEY))?.entries ?? []).toEqual(
      []
    );
  });
});
