/**
 * A profile's shielded (Phoenix) history, from the notes the shielded sync
 * already keeps. Shielded transfers are off on Mainnet and Testnet, so this
 * history is final: it is worked out once and kept.
 *
 * Each note the profile owns is kept as the note tree's leaf: its block
 * height and position are in its bytes, and its value comes from the
 * wallet's own keys. What a leaf doesn't say is which transaction made it,
 * and whether that transaction also spent the profile's notes: a received
 * transfer, or the change of one the profile sent. The blocks at the notes'
 * heights do: every Phoenix transaction's `phoenix` event lists the
 * nullifiers it spent and the notes it made, byte for byte as the leaves hold
 * them. Phoenix transactions always make change for their sender, so the
 * notes' heights hold every transaction that spent the profile's notes too.
 *
 * Asking a node for the blocks at those heights would tell it where the
 * profile's transactions are, so each one hides among four other heights
 * that hold Phoenix notes, from the whole note tree, read once.
 */

import { STAKE_CONTRACT, TRANSFER_CONTRACT, TX_KIND } from "./constants";
import {
  archiveQuery,
  assertArchive,
  errorText,
  rememberNoArchive,
} from "./activityHistory";

/** A NoteLeaf in the note-tree stream: the note (728 bytes), then its block height. */
export const LEAF_BYTES = 736;

/** The note's position in the tree, inside the note. */
export const LEAF_POS_OFFSET = 648;

/** The block height the note entered the tree at. */
export const LEAF_HEIGHT_OFFSET = 728;

/** The note as a `phoenix` event carries the notes a transaction made. */
export const NOTE_BYTES = 728;

/** The part of a note a `convert`, `mint` or `withdraw` event to a shielded receiver carries. */
const RECEIVER_SLICE = /** @type {const} */ ([328, 392]);

/** Other heights each of the profile's heights is asked for among. */
export const DECOYS_PER_HEIGHT = 4;

/** Heights one request asks for. */
export const HEIGHTS_PER_REQUEST = 15;

/** @param {Uint8Array} bytes */
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A leaf's position and block height.
 *
 * @param {Uint8Array} leaf
 * @returns {{ height: number, pos: bigint }}
 */
export function leafInfo(leaf) {
  const view = new DataView(leaf.buffer, leaf.byteOffset, leaf.byteLength);

  return {
    height: Number(view.getBigUint64(LEAF_HEIGHT_OFFSET, true)),
    pos: view.getBigUint64(LEAF_POS_OFFSET, true),
  };
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);

  out.set(a, 0);
  out.set(b, a.length);

  return out;
}

/**
 * A pass-through for the note-tree stream (`leaves_from_pos` from position
 * `from`, 0 by default) that notes each leaf's height on the way, for the
 * decoy heights. `stream()` makes the transform; `heights(total)` gives the
 * distinct heights of the leaves from `from` up to `total` once all of them
 * passed in order, else null. It never changes or stops the stream, whatever
 * it reads.
 *
 * @param {{ from?: bigint }} [options]
 */
export function createLeafHeightTap({ from = 0n } = {}) {
  const start = BigInt(from);
  let rest = new Uint8Array(0);
  let next = start;
  let broken = false;

  /** @type {number[]} */
  const heights = [];

  /** @param {Uint8Array} chunk */
  const take = (chunk) => {
    const bytes = rest.length ? concat(rest, chunk) : chunk;
    let at = 0;

    for (; at + LEAF_BYTES <= bytes.length; at += LEAF_BYTES) {
      const { height, pos } = leafInfo(bytes.subarray(at, at + LEAF_BYTES));

      if (pos !== next) {
        throw new Error("Leaves out of order");
      }

      next += 1n;
      heights.push(height);
    }

    rest = bytes.slice(at);
  };

  return {
    /** @param {number | bigint} total */
    heights(total) {
      const n = Number(total) - Number(start);

      if (broken || !Number.isSafeInteger(n) || n <= 0 || heights.length < n) {
        return null;
      }

      return [...new Set(heights.slice(0, n))];
    },

    stream: () =>
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);

          if (broken) {
            return;
          }

          try {
            take(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
          } catch {
            broken = true;
          }
        },
      }),
  };
}

/**
 * The note tree's heights from one stream of its leaves, from position
 * `from`.
 *
 * @param {any} network A w3sper Network
 * @param {bigint} total The tree's size (num_notes)
 * @param {{ from?: bigint }} [options]
 * @returns {Promise<number[] | null>}
 */
export async function readNoteHeights(network, total, { from = 0n } = {}) {
  const tap = createLeafHeightTap({ from });
  const position = new Uint8Array(8);

  new DataView(position.buffer).setBigUint64(0, BigInt(from), true);

  const response =
    await network.contracts.transferContract.call.leaves_from_pos(position, {
      headers: { "Rusk-Feeder": "true" },
    });

  if (!response?.body) {
    throw new Error("The node sent no note tree");
  }

  const reader = response.body.pipeThrough(tap.stream()).getReader();

  for (;;) {
    const { done } = await reader.read();

    if (done) {
      break;
    }
  }

  return tap.heights(total);
}

/**
 * An unbiased index below n, from 32 random bits.
 *
 * @param {number} n
 * @param {() => number} random
 */
function randomIndex(n, random) {
  const limit = Math.floor(0x1_0000_0000 / n) * n;

  for (;;) {
    const r = random();

    if (r < limit) {
      return r % n;
    }
  }
}

const cryptoRandom = () => crypto.getRandomValues(new Uint32Array(1))[0];

/**
 * The heights to ask for: the profile's own, each among `perHeight` others
 * drawn from the note tree's, shuffled. `keep`: decoys an earlier build drew,
 * kept so asking again shows nothing new.
 *
 * @param {number[]} pool The note tree's distinct heights
 * @param {number[]} real The profile's notes' heights
 * @param {{ keep?: number[], perHeight?: number, random?: () => number }} [options]
 * @returns {{ decoys: number[], heights: number[] }}
 */
export function pickHeights(
  pool,
  real,
  { keep = [], perHeight = DECOYS_PER_HEIGHT, random = cryptoRandom } = {}
) {
  const own = new Set(real);
  const decoys = keep.filter((h) => !own.has(h));
  const taken = new Set(decoys);
  const free = pool.filter((h) => !own.has(h) && !taken.has(h));

  for (
    let want = own.size * perHeight - decoys.length;
    want > 0 && free.length;
    want--
  ) {
    const i = randomIndex(free.length, random);

    decoys.push(free[i]);
    free[i] = free[free.length - 1];
    free.pop();
  }

  const heights = [...own, ...decoys];

  for (let i = heights.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);

    [heights[i], heights[j]] = [heights[j], heights[i]];
  }

  return { decoys, heights };
}

/**
 * One request's GraphQL: each height's contract events, block time and
 * transactions' gas.
 *
 * @param {number[]} heights
 */
export function blocksQuery(heights) {
  const fields = heights.map(
    (h) =>
      `e${h}: contractEvents(height: ${h}) { json } b${h}: block(height: ${h}) { header { timestamp } transactions { id err gasSpent tx { gasPrice } } }`
  );

  return `query { ${fields.join(" ")} }`;
}

/**
 * One block of an answer, as the shielded history reads it.
 *
 * @param {any} data
 * @param {number} h
 * @returns {ShieldedBlock}
 */
function blockOf(data, h) {
  const block = data?.[`b${h}`];
  const seconds = Number(block?.header?.timestamp);
  const events = data?.[`e${h}`]?.json;
  const transactions = Array.isArray(block?.transactions)
    ? block.transactions
    : [];

  return {
    events: Array.isArray(events) ? events : [],
    timestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
    txs: new Map(
      transactions.map((/** @type {any} */ tx) => [
        String(tx?.id ?? "").toLowerCase(),
        tx,
      ])
    ),
  };
}

/**
 * The blocks at `heights`, HEIGHTS_PER_REQUEST a request, in their order;
 * nothing asked of a node without the archive (activityHistory.assertArchive).
 *
 * @param {string} url
 * @param {number[]} heights
 * @returns {Promise<Map<number, ShieldedBlock>>}
 */
export async function fetchBlocks(url, heights) {
  await assertArchive(url);

  /** @type {Map<number, ShieldedBlock>} */
  const out = new Map();

  for (let i = 0; i < heights.length; i += HEIGHTS_PER_REQUEST) {
    const batch = heights.slice(i, i + HEIGHTS_PER_REQUEST);
    const data = await archiveQuery(url, blocksQuery(batch), {
      timeoutMs: 30_000,
    }).catch(async (error) => {
      await rememberNoArchive(url, error);
      throw error;
    });

    for (const h of batch) {
      out.set(h, blockOf(data, h));
    }
  }

  return out;
}

/**
 * Whether `needle` (hex) is in `hay` (hex) at a whole byte.
 *
 * @param {string} hay
 * @param {string} needle
 */
function hexHas(hay, needle) {
  for (
    let at = hay.indexOf(needle);
    at >= 0;
    at = hay.indexOf(needle, at + 1)
  ) {
    if (at % 2 === 0) {
      return true;
    }
  }

  return false;
}

/** @param {unknown} value */
function u64(value) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

/**
 * What one transaction did to the profile's notes.
 *
 * @typedef {{ hash: string, height: number, made: bigint, spent: bigint, topics: Set<string> }} ShieldedTally
 *
 * @typedef {{ matched: boolean, part: string, value: bigint, whole: string }} MadeNote
 */

/**
 * Adds one transfer contract event of a block to its transaction's tally.
 *
 * A Phoenix transaction names the nullifiers it spent and the notes it made
 * (change and the fee's refund included); a contract or a public account
 * sending to a shielded receiver names part of the note.
 *
 * @param {ShieldedTally} entry
 * @param {any} event
 * @param {MadeNote[]} made The profile's notes at this height
 * @param {{ nullifier: string, value: bigint }[]} spentNotes
 */
function tallyTransferEvent(entry, event, made, spentNotes) {
  const data = String(event.data).toLowerCase();
  const phoenix = event.topic === "phoenix";

  entry.topics.add(event.topic);

  if (phoenix) {
    for (const n of spentNotes) {
      if (hexHas(data, n.nullifier)) {
        entry.spent += n.value;
      }
    }
  }

  for (const n of made) {
    if (!n.matched && hexHas(data, phoenix ? n.whole : n.part)) {
      entry.made += n.value;
      n.matched = true;
    }
  }
}

/**
 * The profile's notes by the height they entered the tree at.
 *
 * @param {ShieldedNote[]} notes
 */
function notesByHeight(notes) {
  /** @type {Map<number, ShieldedNote[]>} */
  const byHeight = new Map();

  for (const note of notes) {
    const { height } = leafInfo(note.leaf);
    const list = byHeight.get(height) ?? [];

    list.push(note);
    byHeight.set(height, list);
  }

  return byHeight;
}

/**
 * What each transaction at the profile's notes' heights did to them.
 *
 * @param {ShieldedNote[]} notes
 * @param {Map<number, ShieldedBlock>} blocks
 * @returns {Map<string, ShieldedTally>}
 */
function tallyTransactions(notes, blocks) {
  /** @type {Map<string, ShieldedTally>} */
  const txs = new Map();
  const spentNotes = notes
    .filter((n) => n.spent)
    .map((n) => ({
      nullifier: String(n.nullifier).toLowerCase(),
      value: n.value,
    }));

  /**
   * @param {string} origin
   * @param {number} height
   */
  const tx = (origin, height) => {
    const key = String(origin).toLowerCase();
    const known = txs.get(key);

    if (known) {
      return known;
    }

    const entry = { hash: key, height, made: 0n, spent: 0n, topics: new Set() };

    txs.set(key, entry);

    return entry;
  };

  for (const [height, own] of notesByHeight(notes)) {
    const events = (blocks.get(height)?.events ?? []).filter(
      (e) => e && !e.reverted && typeof e.data === "string" && e.origin
    );
    const made = own.map((n) => ({
      matched: false,
      part: hex(n.leaf.subarray(...RECEIVER_SLICE)),
      value: n.value,
      whole: hex(n.leaf.subarray(0, NOTE_BYTES)),
    }));

    for (const event of events) {
      const source = String(event.source ?? event.target ?? "").toLowerCase();

      if (source === STAKE_CONTRACT) {
        tx(event.origin, height).topics.add(`stake:${event.topic}`);
      } else if (source === TRANSFER_CONTRACT) {
        tallyTransferEvent(tx(event.origin, height), event, made, spentNotes);
      }
    }
  }

  return txs;
}

/**
 * @param {ShieldedTally} t
 * @returns {ActivityKind}
 */
function shieldedKind(t) {
  if (t.topics.has("stake:stake")) {
    return TX_KIND.STAKE;
  }

  if (t.topics.has("stake:unstake")) {
    return TX_KIND.UNSTAKE;
  }

  if (t.topics.has("stake:withdraw")) {
    return TX_KIND.WITHDRAW_REWARD;
  }

  if (t.topics.has("convert")) {
    return t.spent > 0n ? TX_KIND.UNSHIELD : TX_KIND.SHIELD;
  }

  return t.topics.has("deposit") ? TX_KIND.CONTRACT_CALL : TX_KIND.TRANSFER;
}

/**
 * What a transaction paid: the gas it spent at its price.
 *
 * @param {any} info
 */
const feeOf = (info) => u64(info.gasSpent) * u64(info.tx?.gasPrice);

/**
 * @param {bigint} net
 * @returns {ActivityDirection}
 */
const directionOf = (net) => (net > 0n ? "in" : net < 0n ? "out" : "self");

/** @param {bigint} n */
const absolute = (n) => (n < 0n ? -n : n);

/**
 * One transaction of the shielded history, as a row.
 *
 * @param {ShieldedTally} t
 * @param {ShieldedBlock | undefined} block
 * @returns {ActivityRow}
 */
function shieldedRow(t, block) {
  const info = block?.txs.get(t.hash);
  const fee = t.spent > 0n && info ? feeOf(info) : null;
  const net = t.made - t.spent + (fee ?? 0n);
  const direction = directionOf(net);
  const err = errorText(info?.err);

  return {
    amount: direction === "self" ? undefined : absolute(net).toString(),
    blockHeight: t.height,
    direction,
    error: err || undefined,
    feePaid: fee === null ? undefined : fee.toString(),
    hash: t.hash,
    kind: shieldedKind(t),
    privacy: "shielded",
    source: "shielded",
    status: err ? "failed" : "executed",
    timestamp: block?.timestamp ?? undefined,
  };
}

/**
 * The profile's shielded history: one entry per transaction that made or
 * spent its notes, newest first, in the shape of the history's rows.
 *
 * A transaction that spent the profile's notes sent what they held less what
 * came back to it (change, the fee's refund) and the fee; one that only made
 * its notes is what it received. A note no event in its block names is left
 * out.
 *
 * @param {{ blocks: Map<number, ShieldedBlock>, notes: ShieldedNote[] }} input
 *   The profile's notes, unspent and spent, and the blocks at their heights
 * @returns {ActivityRow[]}
 */
export function buildShieldedHistory({ blocks, notes }) {
  const entries = [];

  for (const t of tallyTransactions(notes, blocks).values()) {
    if (t.spent || t.made) {
      entries.push(shieldedRow(t, blocks.get(t.height)));
    }
  }

  return entries.sort(
    (a, b) =>
      Number(b.blockHeight) - Number(a.blockHeight) ||
      (a.hash < b.hash ? -1 : 1)
  );
}
