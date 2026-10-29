/**
 * A public account's transaction history, from the archive node's
 * `moonlightHistory`, synced by block height and kept in this browser
 * (activityStore.js).
 *
 * The archive answers ascending pages only: `moonlightHistory(sender: …)` and
 * `(receiver: …)` list a range's entries oldest first, `maxCount` at a time.
 * A sync covers the chain from the top down in windows, so the newest entries
 * come first: the window under the last finalized block, then wider ones
 * below it while they hold few entries, narrower ones where a page fills.
 * The heights covered are kept, and a later refresh asks only for what is
 * above them, with the last blocks under the finalized one read again: the
 * archive indexes a block once it is final. An entry read again is the same
 * entry, by its hash. Each request carries both directions as GraphQL
 * aliases, and a run makes a bounded number of them; the next one carries on.
 *
 * Times, outcomes and fees come from one aliased `tx(hash:)` request per 50
 * entries. The shielded history is phoenixHistory.js's.
 */

import { get } from "svelte/store";

import { decodeBridgeCall, isBridgeContract } from "$lib/bridge/bridgeCalls";
import nodeNetwork from "$lib/stores/nodeNetwork";

import * as defaultStore from "./activityStore";
import { STAKE_CONTRACT, TRANSFER_CONTRACT, TX_KIND } from "./constants";
import {
  isNameCommitCall,
  isNameRegistration,
  nameCommitOf,
  registeredNameOf,
} from "./knownContracts";

export { STAKE_CONTRACT, TRANSFER_CONTRACT };

/** Entries one history query returns per direction. */
export const PAGE = 50;

/** The first window: about a day of 10-second blocks. */
export const FIRST_WINDOW = 8_640;

/** Blocks under the last finalized one that a sync counts as covered: the archive may not have indexed the newest yet. */
export const FINALITY_MARGIN = 10;

/** Transactions one details request looks up. */
export const DETAILS_BATCH = 50;

/** History requests one run makes, and details requests after them. */
export const RUN_REQUESTS = 8;
export const RUN_DETAIL_REQUESTS = 2;

/** How long a node that answered without the archive is left alone. */
export const NO_ARCHIVE_RETRY_MS = 60 * 60_000;

const REQUEST_TIMEOUT_MS = 8_000;

// What a node without the archive answers: its GraphQL has no history fields.
const NO_ARCHIVE = /Unknown field\W+(?:moonlightHistory|contractEvents)\b/i;

const MAX_WINDOW = 2 ** 40;
const MAX_U64 = (1n << 64n) - 1n;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const HASH = /^[0-9a-f]{64}$/;

/** @typedef {typeof defaultStore} ActivityStoreModule */

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * The archive to read a network's history from: the archiver given, else
 * the node, which keeps it on Dusk's own networks.
 *
 * @param {{ archiverUrl?: string, nodeUrl?: string }} urls
 * @returns {string}
 */
export function historyArchiverUrl({ archiverUrl, nodeUrl } = {}) {
  return String(archiverUrl ?? "").trim() || String(nodeUrl ?? "").trim();
}

/**
 * The network a history belongs to: Mainnet and Testnet by name, as the
 * chain ID the node gives names them, so a custom node of a network shares
 * its history; any other node by its base URL, with its path.
 *
 * @param {string} nodeUrl
 */
export function activityNetworkKey(nodeUrl) {
  const name = get(nodeNetwork)?.name;

  if (name === "mainnet" || name === "testnet") {
    return name;
  }

  try {
    const url = new URL(String(nodeUrl));

    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return String(nodeUrl ?? "");
  }
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

/**
 * JSON whose integers of 16 digits or more become strings, so no amount
 * loses precision.
 *
 * @param {string} text
 * @returns {any}
 */
function losslessJson(text) {
  const parts = String(text).split(/("(?:\\.|[^"\\])*")/g);

  return JSON.parse(
    parts
      .map((part, index) =>
        index % 2
          ? part
          : part.replace(
              /([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
              (_, prefix, n) => `${prefix}"${n}"`
            )
      )
      .join("")
  );
}

/** A node that answered without the archive, or was left alone for having done so. */
export class NoArchiveError extends Error {
  /**
   * @param {string} url
   * @param {string} [message]
   */
  constructor(url, message = `${url} has no archive`) {
    super(message);
    this.name = "NoArchiveError";
    this.url = url;
  }
}

/**
 * A fetch that gives up on a response that takes longer than `timeoutMs`.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One GraphQL request to a node's `/on/graphql/query`. A node without the
 * archive's fields throws a NoArchiveError.
 *
 * @param {string} baseUrl
 * @param {string} query
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<any>} The data
 */
export async function archiveQuery(
  baseUrl,
  query,
  { timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const res = await fetchWithTimeout(
    `${String(baseUrl).replace(/\/+$/, "")}/on/graphql/query`,
    { body: query, headers: { "Content-Type": "text/plain" }, method: "POST" },
    timeoutMs
  );

  if (!res.ok) {
    throw new Error(`Archive request failed (${res.status})`);
  }

  const json = losslessJson(await res.text());

  if (Array.isArray(json?.errors) && json.errors.length) {
    const message = json.errors
      .map((/** @type {any} */ e) => e?.message || String(e))
      .join("; ");

    throw NO_ARCHIVE.test(message)
      ? new NoArchiveError(baseUrl, message)
      : new Error(message);
  }

  return json?.data && typeof json.data === "object" ? json.data : (json ?? {});
}

/**
 * Throw a NoArchiveError, without a request, for a node that answered
 * without the archive in the last hour.
 *
 * @param {string} url
 * @param {ActivityStoreModule} [store]
 * @param {number} [now]
 */
export async function assertArchive(
  url,
  store = defaultStore,
  now = Date.now()
) {
  const at = await store.getArchiveRefusal(url).catch(() => null);

  if (at !== null && now - at >= 0 && now - at < NO_ARCHIVE_RETRY_MS) {
    throw new NoArchiveError(url);
  }
}

/**
 * Keep `url`'s refusal when `error` was one, for assertArchive.
 *
 * @param {string} url
 * @param {unknown} error
 * @param {ActivityStoreModule} [store]
 */
export async function rememberNoArchive(url, error, store = defaultStore) {
  if (error instanceof NoArchiveError && error.url === url) {
    await store.putArchiveRefusal(url, Date.now()).catch(() => {});
  }
}

/**
 * @param {string} alias
 * @param {"receiver" | "sender"} direction
 * @param {string} account
 * @param {{ from: number, page: number, to?: number }} range
 */
function history(alias, direction, account, { from, page, to }) {
  const args = [
    `${direction}: ${JSON.stringify(account)}`,
    `fromBlock: ${from}`,
  ];

  if (to !== undefined) {
    args.push(`toBlock: ${to}`);
  }

  args.push(`maxCount: ${PAGE}`);

  if (page > 1) {
    args.push(`pageCount: ${page}`);
  }

  return `${alias}: moonlightHistory(${args.join(", ")}) { json }`;
}

const HEAD_FIELDS =
  "pair: lastBlockPair { json } genesis: block(height: 0) { header { hash } }";

const HEAD_QUERY = `query { ${HEAD_FIELDS} }`;

/**
 * The range `[from, to]` of both directions, `to` open when undefined: one
 * request.
 *
 * @param {string} account
 * @param {{ from: number, head?: boolean, page?: number, to?: number }} range
 */
function rangeQuery(account, { from, head = false, page = 1, to }) {
  const fields = [
    head ? HEAD_FIELDS : "",
    history("out", "sender", account, { from, page, to }),
    history("in", "receiver", account, { from, page, to }),
  ];

  return `query { ${fields.filter(Boolean).join(" ")} }`;
}

/**
 * The value at `path` in `value`, or undefined where the path breaks off.
 *
 * @param {any} value
 * @param {...(number | string)} path
 * @returns {any}
 */
const dig = (value, ...path) =>
  path.reduce(
    (at, key) => (at === null || at === undefined ? undefined : at[key]),
    value
  );

/**
 * @param {any} data
 * @returns {{ finalized: number, genesis: string, tip: number }}
 */
function readHead(data) {
  const pair = dig(data, "pair", "json");
  const finalized = Number(dig(pair, "last_finalized_block", 0));
  const tip = Number(dig(pair, "last_block", 0));
  const genesis = String(dig(data, "genesis", "header", "hash") ?? "");

  if (!Number.isSafeInteger(finalized) || finalized < 0) {
    throw new Error("Archive gave no finalized height");
  }

  return {
    finalized,
    genesis,
    tip: Number.isSafeInteger(tip) ? tip : finalized,
  };
}

/**
 * @param {any} field
 * @returns {any[]}
 */
const listOf = (field) => (Array.isArray(field?.json) ? field.json : []);

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {bigint}
 */
function u64(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+$/.test(text)) {
    return 0n;
  }

  const n = BigInt(text);

  return n <= MAX_U64 ? n : 0n;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * A memo as text when it is UTF-8 without control characters, else as 0x hex.
 *
 * @param {unknown} hex
 */
function memoText(hex) {
  const h = String(hex ?? "");

  if (!h || h.length % 2 || !/^[0-9a-f]+$/i.test(h)) {
    return "";
  }

  const bytes = Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

  try {
    const text = utf8.decode(bytes);

    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      return text;
    }
  } catch {
    // not text
  }

  return `0x${h.toLowerCase()}`;
}

/** @param {any} receiver */
const moonlightOf = (receiver) =>
  receiver && typeof receiver === "object"
    ? (receiver.Moonlight ?? null)
    : null;

/** @param {any} receiver */
const phoenixOf = (receiver) =>
  receiver && typeof receiver === "object" ? (receiver.Phoenix ?? null) : null;

/**
 * What an entry's events say, as they are read.
 *
 * @typedef {{
 *   counterparty: string | null,
 *   inValue: bigint,
 *   kind: ActivityKind | null,
 *   memo: string,
 *   outValue: bigint,
 *   payer: boolean,
 *   receivedFrom: string | null,
 *   selfValue: bigint | null,
 *   sentTo: string | null,
 *   stakeTopics: Set<string>,
 * }} EntryTally
 */

/**
 * Unspent gas refunded to the account when another one sent the
 * transaction.
 *
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} d
 */
function readRefund(t, account, d) {
  if (
    Array.isArray(d.refund_info) &&
    d.refund_info[0] === account &&
    d.sender !== account
  ) {
    t.inValue += u64(d.refund_info[1]);
    t.receivedFrom ??= d.sender;
  }
}

/**
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} d
 */
function readMoonlight(t, account, d) {
  const value = u64(d.value);

  // No receiver means the sender's own account (dusk-core's
  // MoonlightTransaction::receiver), as for a contract call.
  const receiver = d.receiver ?? d.sender;

  if (d.sender === account) {
    t.payer = true;
  }

  if (d.sender === account || receiver === account) {
    t.memo = memoText(d.memo);
  }

  if (d.sender === account && receiver === account) {
    t.selfValue = (t.selfValue ?? 0n) + value;
  } else if (d.sender === account) {
    t.outValue += value;
    t.sentTo ??= receiver;
  } else if (receiver === account) {
    t.inValue += value;
    t.receivedFrom ??= d.sender;
  }

  readRefund(t, account, d);
}

/**
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} d
 */
function readConvert(t, account, d) {
  const value = u64(d.value);

  if (d.sender === account) {
    t.outValue += value;
    t.kind = TX_KIND.SHIELD;
    t.counterparty = phoenixOf(d.receiver);
  } else if (moonlightOf(d.receiver) === account) {
    t.inValue += value;
    t.kind = TX_KIND.UNSHIELD;
  }
}

/**
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} d
 */
function readDeposit(t, account, d) {
  if (d.sender !== account) {
    return;
  }

  t.outValue += u64(d.value);

  const to = String(d.receiver ?? "").toLowerCase();

  t.kind ??= to === STAKE_CONTRACT ? TX_KIND.STAKE : TX_KIND.CONTRACT_CALL;
  t.counterparty ??= to || null;
}

/**
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} d
 * @param {string} topic
 */
function readWithdraw(t, account, d, topic) {
  if (moonlightOf(d.receiver) !== account) {
    return;
  }

  t.inValue += u64(d.value);

  const from = String(d.sender ?? "").toLowerCase();

  if (from === STAKE_CONTRACT) {
    t.kind ??= topic === "mint" ? TX_KIND.WITHDRAW_REWARD : TX_KIND.UNSTAKE;
  }

  t.receivedFrom ??= from || null;
}

/**
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} d
 */
function readContractToAccount(t, account, d) {
  if (d.receiver !== account) {
    return;
  }

  t.inValue += u64(d.value);
  t.receivedFrom ??= String(d.sender ?? "").toLowerCase() || null;
}

/** @type {Map<string, (t: EntryTally, account: string, d: any, topic: string) => void>} */
const TRANSFER_EVENTS = new Map([
  ["contract_to_account", readContractToAccount],
  ["convert", readConvert],
  ["deposit", readDeposit],
  ["mint", readWithdraw],
  ["moonlight", readMoonlight],
  ["withdraw", readWithdraw],
]);

/**
 * Adds one event to the tally; reverted events don't count.
 *
 * @param {EntryTally} t
 * @param {string} account
 * @param {any} event
 */
function readEvent(t, account, event) {
  if (!event || typeof event !== "object" || event.reverted === true) {
    return;
  }

  const target = String(event.target ?? "").toLowerCase();
  const topic = String(event.topic ?? "");

  if (target === STAKE_CONTRACT) {
    t.stakeTopics.add(topic);

    return;
  }

  const d = event.data;

  if (target === TRANSFER_CONTRACT && d && typeof d === "object") {
    TRANSFER_EVENTS.get(topic)?.(t, account, d, topic);
  }
}

/**
 * What left or reached the account, fees aside, and which way.
 *
 * @param {EntryTally} t
 * @returns {{ direction: ActivityDirection, value: bigint }}
 */
function netOf(t) {
  const net = t.inValue - t.outValue;

  if (net > 0n) {
    return { direction: "in", value: net };
  }

  if (net < 0n) {
    return { direction: "out", value: -net };
  }

  if (t.selfValue !== null && t.selfValue > 0n && t.inValue === 0n) {
    return { direction: "self", value: t.selfValue };
  }

  // Nothing moved but the fee: a contract call without a deposit, or one
  // that failed.
  return { direction: t.payer ? "out" : "in", value: 0n };
}

/**
 * @param {EntryTally} t
 * @param {ActivityDirection} direction
 * @returns {ActivityKind}
 */
function kindOf(t, direction) {
  // The stake contract's own events say which stake operation a withdraw was.
  if (
    t.kind === TX_KIND.UNSTAKE &&
    t.stakeTopics.has("withdraw") &&
    !t.stakeTopics.has("unstake")
  ) {
    return TX_KIND.WITHDRAW_REWARD;
  }

  if (t.kind) {
    return t.kind;
  }

  if (direction === "self" || t.sentTo || t.receivedFrom) {
    return TX_KIND.TRANSFER;
  }

  return t.payer ? TX_KIND.CONTRACT_CALL : TX_KIND.TRANSFER;
}

/**
 * @param {EntryTally} t
 * @param {string} account
 * @param {ActivityDirection} direction
 * @returns {string | null}
 */
function counterpartyOf(t, account, direction) {
  if (t.counterparty) {
    return t.counterparty;
  }

  if (direction === "self") {
    return account;
  }

  return (direction === "out" ? t.sentTo : t.receivedFrom) || null;
}

/**
 * One archive entry as `account` sees it, from the transfer contract's
 * events; reverted events don't count. Null for an entry of another shape.
 *
 * `value` is what left or reached the account, fees aside; `direction` says
 * which, "self" for a transfer to itself. `payer` is whether the account
 * paid the fee.
 *
 * @param {string} account
 * @param {any} entry `{ block_height, origin, events }`
 * @returns {ActivityParsedEntry | null}
 */
export function parseHistoryEntry(account, entry) {
  const hash = String(entry?.origin ?? "").toLowerCase();
  const blockHeight = Number(entry?.block_height);

  if (
    !HASH.test(hash) ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 0
  ) {
    return null;
  }

  /** @type {EntryTally} */
  const t = {
    counterparty: null,
    inValue: 0n,
    kind: null,
    memo: "",
    outValue: 0n,
    payer: false,
    receivedFrom: null,
    selfValue: null,
    sentTo: null,
    stakeTopics: new Set(),
  };

  for (const event of Array.isArray(entry?.events) ? entry.events : []) {
    readEvent(t, account, event);
  }

  const { direction, value } = netOf(t);

  return {
    blockHeight,
    counterparty: counterpartyOf(t, account, direction),
    direction,
    hash,
    kind: kindOf(t, direction),
    memo: t.memo,
    payer: t.payer,
    value,
  };
}

// ---------------------------------------------------------------------------
// Coverage: disjoint [lo, hi] ranges of heights whose entries are all kept,
// highest first.
// ---------------------------------------------------------------------------

/**
 * `covered` with `[lo, hi]` added, touching and overlapping ranges joined.
 *
 * @param {number[][]} covered
 * @param {number} lo
 * @param {number} hi
 * @returns {number[][]}
 */
export function addCoverage(covered, lo, hi) {
  if (!(hi >= lo)) {
    return covered.map((r) => [...r]);
  }

  const ranges = [...covered.map((r) => [...r]), [lo, hi]].sort(
    (a, b) => a[0] - b[0]
  );

  /** @type {number[][]} */
  const out = [];

  for (const [a, b] of ranges) {
    const last = out[out.length - 1];

    if (last && a <= last[1] + 1) {
      last[1] = Math.max(last[1], b);
    } else {
      out.push([a, b]);
    }
  }

  return out.reverse();
}

/**
 * The highest range of `[0, target]` that `covered` misses, or null.
 *
 * @param {number[][]} covered Highest first
 * @param {number} target
 * @returns {[number, number] | null}
 */
export function topGap(covered, target) {
  let hi = target;

  for (const [a, b] of covered) {
    if (b < hi) {
      return [b + 1, hi];
    }

    hi = Math.min(hi, a - 1);

    if (hi < 0) {
      return null;
    }
  }

  return hi >= 0 ? [0, hi] : null;
}

/**
 * The lowest height the history shows entries down to: the bottom of the
 * range that reaches `target`, or of the highest range while the top is
 * still being filled; null before anything is covered. Below it, newer
 * entries may be missing.
 *
 * @param {number[][]} covered
 * @param {number} target
 * @returns {number | null}
 */
export function shownDownTo(covered, target) {
  const top =
    covered.find(([a, b]) => a <= target && b >= target) ?? covered[0];

  return top ? top[0] : null;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

let warnedUnavailable = false;

/**
 * Says once per page that the archive is unavailable.
 *
 * @param {unknown} error
 */
export function noteActivityUnavailable(error) {
  if (warnedUnavailable) {
    return;
  }

  warnedUnavailable = true;

  // eslint-disable-next-line no-console
  console.warn(
    "Activity history is unavailable; showing this wallet's own transactions.",
    /** @type {any} */ (error)?.message ?? error
  );
}

/**
 * @param {ActivityParsedEntry} parsed
 * @returns {ActivityStoredEntry}
 */
const toStored = (parsed) => ({ ...parsed, value: parsed.value.toString() });

/**
 * The entries of one answer to a range query, both directions.
 *
 * @param {string} account
 * @param {any[]} out
 * @param {any[]} inn
 * @returns {ActivityParsedEntry[]}
 */
function entriesOf(account, out, inn) {
  /** @type {ActivityParsedEntry[]} */
  const entries = [];

  for (const raw of [...out, ...inn]) {
    const parsed = parseHistoryEntry(account, raw);

    if (parsed) {
      entries.push(parsed);
    }
  }

  return entries;
}

/**
 * One range of both directions, `to` open when undefined. With `head`, the
 * same request reads the last finalized block and the genesis hash.
 *
 * The range holds `entries`; it is complete from `from` up to `completeTo`
 * (inclusive), which is `to` unless a direction filled its page, and then
 * the height under that page's last entry, which may have more.
 *
 * @param {string} url
 * @param {string} account
 * @param {{ from: number, head?: boolean, to?: number }} range
 */
async function readRange(url, account, { from, head = false, to }) {
  const data = await archiveQuery(url, rangeQuery(account, { from, head, to }));
  const out = listOf(data.out);
  const inn = listOf(data.in);
  let completeTo = to;
  let fullPages = 0;

  for (const list of [out, inn]) {
    if (list.length >= PAGE) {
      const last = Number(list[list.length - 1]?.block_height);
      const below = Number.isSafeInteger(last) ? last - 1 : from - 1;

      fullPages += 1;
      completeTo =
        completeTo === undefined ? below : Math.min(completeTo, below);
    }
  }

  return {
    completeTo,
    count: Math.max(out.length, inn.length),
    entries: entriesOf(account, out, inn),
    fullPages,
    head: head ? readHead(data) : null,
  };
}

/**
 * One block holding more than a page, a page at a time from `fromPage`,
 * while the budget lasts: `page` is where to carry on when it is not
 * `complete`.
 *
 * @param {string} url
 * @param {string} account
 * @param {number} height
 * @param {{ left: number }} budget
 * @param {number} fromPage
 */
async function readBlock(url, account, height, budget, fromPage) {
  /** @type {ActivityParsedEntry[]} */
  const entries = [];
  let page = fromPage;

  for (; budget.left > 0; page++) {
    budget.left -= 1;

    const data = await archiveQuery(
      url,
      rangeQuery(account, { from: height, page, to: height })
    );
    const out = listOf(data.out);
    const inn = listOf(data.in);

    entries.push(...entriesOf(account, out, inn));

    if (out.length < PAGE && inn.length < PAGE) {
      return { complete: true, entries, page: page + 1 };
    }
  }

  return { complete: false, entries, page };
}

/**
 * @param {number} window
 * @param {number} count
 */
function nextWindow(window, count) {
  if (count < PAGE / 4) {
    return Math.min(window * 8, MAX_WINDOW);
  }

  if (count < PAGE / 2) {
    return Math.min(window * 2, MAX_WINDOW);
  }

  return window;
}

/**
 * @typedef {{
 *   account: string,
 *   archiverUrl?: string,
 *   epoch?: number,
 *   maxDetailRequests?: number,
 *   maxRequests?: number,
 *   nodeUrl: string,
 *   onStep?: (meta: ActivityMeta) => void,
 *   store?: ActivityStoreModule,
 * }} SyncOptions
 *
 * @typedef {{
 *   cover?: number[][],
 *   set?: Partial<ActivityMeta>,
 * }} SyncPatch
 */

/** One sync run of an account's history, as syncActivity describes it. */
class HistorySync {
  added = 0;

  /** @type {{ left: number }} */
  budget;

  detailsLeft;

  /** @type {number | undefined} */
  epoch;

  /** @type {ActivityMeta} */
  meta = /** @type {any} */ (null);

  ownerKey;

  options;

  store;

  url;

  /** @param {SyncOptions} options */
  constructor(options) {
    this.options = options;
    this.store = options.store ?? defaultStore;
    this.url = historyArchiverUrl(options);
    this.ownerKey = this.store.activityOwnerKey(
      activityNetworkKey(options.nodeUrl),
      options.account
    );
    this.budget = {
      left: Math.max(1, Math.floor(options.maxRequests ?? RUN_REQUESTS)),
    };
    this.detailsLeft = Math.max(
      0,
      Math.floor(options.maxDetailRequests ?? RUN_DETAIL_REQUESTS)
    );
  }

  /**
   * Keeps a step: its entries and its coverage. The first entries a run finds
   * are the newest: their times and outcomes come at once, before the run
   * reads further down.
   *
   * @param {ActivityParsedEntry[]} entries
   * @param {SyncPatch} patch
   */
  async commit(entries, patch) {
    const { account, onStep } = this.options;

    this.meta = await this.store.commitActivityStep(
      this.ownerKey,
      entries.map(toStored),
      (kept) => {
        // Two tabs syncing at once: keep what the other one covered too.
        let covered = kept?.covered ?? [];

        for (const [lo, hi] of patch.cover ?? []) {
          covered = addCoverage(covered, lo, hi);
        }

        return /** @type {ActivityMeta} */ ({
          ...kept,
          ...patch.set,
          account,
          covered,
          updatedAt: Date.now(),
        });
      },
      this.epoch
    );
    this.added += entries.length;
    onStep?.(this.meta);

    if (entries.length && this.added === entries.length && this.detailsLeft) {
      this.detailsLeft -= 1;
      await this.details(1);
    }
  }

  /** @param {number} maxRequests */
  details(maxRequests) {
    return fillDetails({
      epoch: this.epoch,
      maxRequests,
      onStep: () => this.options.onStep?.(this.meta),
      ownerKey: this.ownerKey,
      store: this.store,
      url: this.url,
    });
  }

  /**
   * Fills what is missing from the top down, while the budget lasts.
   *
   * @param {number} target
   */
  async fill(target) {
    let window = Number(this.meta?.window) || FIRST_WINDOW;

    while (this.budget.left > 0) {
      const gap = topGap(this.meta.covered ?? [], target);

      if (!gap) {
        break;
      }

      window = await this.step(gap, window);
    }
  }

  /**
   * The head: the last finalized block, and with it, when a range is kept,
   * everything above that range. Null, or the result of a run that started
   * over on another chain.
   *
   * @returns {Promise<number | Awaited<ReturnType<typeof syncOnce>>>} The target height, or a restarted run's result
   */
  async head() {
    const keptTop = this.meta?.covered?.[0]?.[1];

    this.budget.left -= 1;

    const first =
      keptTop === undefined
        ? {
            completeTo: undefined,
            entries: [],
            head: readHead(await archiveQuery(this.url, HEAD_QUERY)),
          }
        : await readRange(this.url, this.options.account, {
            from: keptTop + 1,
            head: true,
          });
    const { finalized, genesis } = /** @type {ReturnType<typeof readHead>} */ (
      first.head
    );
    const target = finalized - FINALITY_MARGIN;

    // Another chain under the same name (a reset devnet or local node): all
    // that is kept of the old one goes, and this account starts over, still
    // as this run's work: a reset meanwhile refuses both (StaleActivityError).
    if (this.isOtherChain(genesis)) {
      await this.store.clearChainActivity(
        activityNetworkKey(this.options.nodeUrl),
        this.epoch
      );

      return syncOnce({
        ...this.options,
        epoch: this.epoch,
        maxRequests: this.budget.left + 1,
      });
    }

    const set = {
      finalized,
      genesis: genesis || this.meta?.genesis || "",
      headAt: Date.now(),
      target,
    };

    if (keptTop === undefined) {
      await this.commit([], { set: { ...set, window: FIRST_WINDOW } });
    } else {
      const top = Math.min(first.completeTo ?? target, target);

      await this.commit(first.entries, {
        cover: top > keptTop ? [[keptTop + 1, top]] : [],
        set,
      });
    }

    return target;
  }

  /**
   * Whether the node's chain isn't the one the kept history came from.
   *
   * @param {string} genesis
   */
  isOtherChain(genesis) {
    return Boolean(
      this.meta?.genesis && genesis && this.meta.genesis !== genesis
    );
  }

  /**
   * A block with more than a page at the top of what is missing: its pages
   * carry on where an earlier step left them.
   *
   * @param {number} b
   */
  async crowded(b) {
    const block = await readBlock(
      this.url,
      this.options.account,
      b,
      this.budget,
      /** @type {{ page: number }} */ (this.meta.crowded).page
    );

    await this.commit(
      block.entries,
      block.complete
        ? { cover: [[b, b]], set: { crowded: null } }
        : { set: { crowded: { height: b, page: block.page } } }
    );
  }

  /**
   * One step of the fill: the window under the gap's top.
   *
   * @param {[number, number]} gap
   * @param {number} window
   * @returns {Promise<number>} The next window
   */
  async step([a, b], window) {
    if (this.meta.crowded?.height === b) {
      await this.crowded(b);

      return window;
    }

    const lo = Math.max(a, b - window + 1);

    this.budget.left -= 1;

    const range = await readRange(this.url, this.options.account, {
      from: lo,
      to: b,
    });

    if (!range.fullPages) {
      const next = nextWindow(window, range.count);

      await this.commit(range.entries, {
        cover: [[lo, b]],
        set: { window: next },
      });

      return next;
    }

    return this.fullPage(range, lo, b);
  }

  /**
   * A page filled: what is under its last entry is complete; the rest of the
   * window gets a narrower one, sized to fit in a page.
   *
   * @param {Awaited<ReturnType<typeof readRange>>} range
   * @param {number} lo
   * @param {number} b
   * @returns {Promise<number>} The next window
   */
  async fullPage(range, lo, b) {
    const completeTo = /** @type {number} */ (range.completeTo);

    if (completeTo >= lo) {
      const window = Math.max(1, Math.floor((completeTo - lo + 2) / 2));

      await this.commit(range.entries, {
        cover: [[lo, completeTo]],
        set: { window },
      });

      return window;
    }

    // A page filled within the window's lowest block, which holds more than
    // a page: the heights above it come first, then its pages, from the
    // second, kept as they go.
    if (lo < b) {
      await this.commit(range.entries, {
        set: { crowded: { height: lo, page: 2 }, window: b - lo },
      });

      return b - lo;
    }

    const block = await readBlock(
      this.url,
      this.options.account,
      lo,
      this.budget,
      2
    );

    await this.commit(
      [...range.entries, ...block.entries],
      block.complete
        ? { cover: [[lo, lo]], set: { crowded: null, window: 1 } }
        : { set: { crowded: { height: lo, page: block.page }, window: 1 } }
    );

    return 1;
  }

  /** @returns {Promise<{ added: number, meta: ActivityMeta, requests: number }>} */
  async run() {
    const { maxRequests = RUN_REQUESTS } = this.options;

    // A wallet reset during the run makes its writes fail (StaleActivityError).
    this.epoch = this.options.epoch ?? (await this.store.getActivityEpoch());
    this.meta = /** @type {ActivityMeta} */ (
      await this.store.getActivityMeta(this.ownerKey)
    );

    const target = await this.head();

    if (typeof target !== "number") {
      return target;
    }

    await this.fill(target);
    await this.details(this.detailsLeft);

    return {
      added: this.added,
      meta: this.meta,
      requests: Math.max(1, Math.floor(maxRequests)) - this.budget.left,
    };
  }
}

/**
 * @param {SyncOptions} options
 * @returns {Promise<{ added: number, meta: ActivityMeta, requests: number }>}
 */
async function syncOnce(options) {
  if (!BASE58.test(String(options.account ?? ""))) {
    throw new Error("A public account is required");
  }

  if (!historyArchiverUrl(options)) {
    throw new Error("No archive configured");
  }

  return new HistorySync(options).run();
}

/**
 * Run a sync of `account`'s history: the newest heights first, then older
 * ones, at most `maxRequests` history requests and `maxDetailRequests`
 * details requests. Each step is kept as it lands, so a run that stops
 * anywhere is carried on by the next. `onStep` hears every kept step. A node
 * that answered without the archive is asked nothing for an hour.
 *
 * `epoch` is the store's lifecycle epoch when the caller first saw the
 * account (getActivityEpoch): after a wallet reset since, nothing is kept and
 * the run rejects with StaleActivityError. It is read at the start when not
 * given.
 *
 * @param {SyncOptions} options
 * @returns {Promise<{ added: number, meta: ActivityMeta, requests: number }>}
 */
export async function syncActivity(options) {
  const url = historyArchiverUrl(options);
  const store = options.store ?? defaultStore;

  if (url) {
    await assertArchive(url, store);
  }

  try {
    return await syncOnce(options);
  } catch (error) {
    await rememberNoArchive(url, error, store);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

/**
 * @param {any} tx
 * @returns {ActivityDetails}
 */
/**
 * A transaction's error as text: "" for none.
 *
 * @param {unknown} err
 */
export const errorText = (err) =>
  err === null || err === undefined
    ? ""
    : typeof err === "string"
      ? err
      : JSON.stringify(err);

/**
 * A text field, or undefined when it is empty.
 *
 * @param {unknown} value
 */
const textOrUndefined = (value) => (value ? String(value) : undefined);

/**
 * Whether an entry's details are still to look up: it has none, or it is a
 * call to the bridge looked up before the history read what bridge calls
 * do, or a withdrawal's proof or claim read before the history kept the
 * withdrawal's hash, which its claim date is read by, or a `.dusk` name's
 * registration read before the history read which name it was, or a
 * reservation or registration before it read what they hold of each other.
 *
 * @param {{ bridge?: import("$lib/bridge/bridgeCalls").BridgeCall | null, contractId?: string, detailsAt?: number, fnName?: string, nameCommit?: import("./knownContracts").NameCommit | null, registeredName?: string | null }} entry
 */
export const needsDetails = (entry) =>
  !entry.detailsAt ||
  (entry.bridge === undefined && isBridgeContract(entry.contractId)) ||
  ((entry.bridge?.kind === "prove" || entry.bridge?.kind === "claim") &&
    !entry.bridge.hash) ||
  (entry.registeredName === undefined && isNameRegistration(entry)) ||
  (entry.nameCommit === undefined && isNameCommitCall(entry));

/**
 * @param {any} tx
 * @returns {ActivityDetails}
 */
function detailsOf(tx) {
  const gasSpent = u64(tx.gasSpent);
  const gasPrice = u64(dig(tx, "tx", "gasPrice"));
  const seconds = Number(tx.blockTimestamp);
  const err = errorText(tx.err);
  const blockHash = String(tx.blockHash ?? "");
  const contractId = textOrUndefined(dig(tx, "tx", "callData", "contractId"));
  const fnName = textOrUndefined(dig(tx, "tx", "callData", "fnName"));
  const data = dig(tx, "tx", "callData", "data");

  const registeredName = registeredNameOf({ contractId, data, fnName });
  const nameCommit = nameCommitOf({ contractId, data, fnName });

  return {
    blockHash: HASH.test(blockHash) ? blockHash : undefined,
    bridge: decodeBridgeCall({ contractId, data, fnName }),
    contractId,
    detailsAt: Date.now(),
    error: err || undefined,
    fee: (gasSpent * gasPrice).toString(),
    fnName,
    gasLimit: u64(dig(tx, "tx", "gasLimit")).toString(),
    gasPrice: gasPrice.toString(),
    gasSpent: gasSpent.toString(),
    ...(nameCommit === undefined ? {} : { nameCommit }),
    ...(registeredName === undefined ? {} : { registeredName }),
    success: !err,
    timestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
  };
}

/**
 * Times, outcomes, fees and calls of transactions, from one aliased request:
 * by hash, for those the node has.
 *
 * @param {string} url
 * @param {string[]} hashes At most DETAILS_BATCH
 * @returns {Promise<Map<string, ActivityDetails>>}
 */
export async function fetchTxDetails(url, hashes) {
  const list = hashes.filter((h) => HASH.test(h)).slice(0, DETAILS_BATCH);

  /** @type {Map<string, ActivityDetails>} */
  const out = new Map();

  if (!list.length) {
    return out;
  }

  const fields = list.map(
    (hash, i) =>
      `t${i}: tx(hash: "${hash}") { err gasSpent blockHash blockTimestamp tx { gasPrice gasLimit callData { contractId fnName data } } }`
  );
  const data = await archiveQuery(url, `query { ${fields.join(" ")} }`);

  list.forEach((hash, i) => {
    const tx = data?.[`t${i}`];

    if (tx && typeof tx === "object") {
      out.set(hash, detailsOf(tx));
    }
  });

  return out;
}

/**
 * A public transaction's nonce, from its JSON: null for a shielded one, or
 * one the node doesn't have.
 *
 * @param {string} url
 * @param {string} hash
 * @returns {Promise<string | null>}
 */
export async function fetchTxNonce(url, hash) {
  if (!HASH.test(hash)) {
    return null;
  }

  const data = await archiveQuery(
    url,
    `query { tx(hash: "${hash}") { tx { json } } }`
  );

  try {
    const { nonce } = JSON.parse(String(dig(data, "tx", "tx", "json") ?? ""));

    return typeof nonce === "number" || typeof nonce === "string"
      ? String(nonce)
      : null;
  } catch {
    return null;
  }
}

/**
 * Details for the newest kept entries that have none, a batch per request.
 *
 * @param {{
 *   entries?: ActivityStoredEntry[] | ActivityEntry[],
 *   epoch?: number,
 *   maxRequests: number,
 *   onStep?: () => void,
 *   ownerKey: string,
 *   store: ActivityStoreModule,
 *   url: string,
 * }} options
 */
async function fillDetails({
  entries,
  epoch,
  maxRequests,
  onStep,
  ownerKey,
  store,
  url,
}) {
  let requests = Math.max(0, Math.floor(maxRequests));

  if (!requests) {
    return;
  }

  const missing = (
    entries ??
    (await store.listActivityEntries(ownerKey, {
      limit: DETAILS_BATCH * requests,
    }))
  )
    .filter(needsDetails)
    .map((e) => e.hash);

  for (let i = 0; i < missing.length && requests > 0; i += DETAILS_BATCH) {
    const details = await fetchTxDetails(
      url,
      missing.slice(i, i + DETAILS_BATCH)
    );

    // A transaction the node doesn't have yet is looked up again next time.
    await store.patchActivityEntries(ownerKey, details, epoch);
    onStep?.();
    requests -= 1;
  }
}

/**
 * Details for kept entries shown before a sync gave them any, as older ones
 * are: one request per 50. `epoch` as for syncActivity.
 *
 * @param {{
 *   account: string,
 *   archiverUrl?: string,
 *   entries: ActivityEntry[],
 *   epoch?: number,
 *   nodeUrl: string,
 *   store?: ActivityStoreModule,
 * }} options
 */
export async function fillActivityDetails({
  account,
  archiverUrl,
  entries,
  epoch,
  nodeUrl,
  store = defaultStore,
}) {
  const url = historyArchiverUrl({ archiverUrl, nodeUrl });
  const ownerKey = store.activityOwnerKey(activityNetworkKey(nodeUrl), account);
  const missing = entries.filter(needsDetails);

  await fillDetails({
    entries: missing,
    epoch: epoch ?? (await store.getActivityEpoch()),
    maxRequests: Math.ceil(missing.length / DETAILS_BATCH),
    ownerKey,
    store,
    url,
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A kept entry as the history uses it: amounts as bigints.
 *
 * @param {ActivityStoredEntry} row
 * @returns {ActivityEntry}
 */
export function activityEntry(row) {
  return {
    blockHash: row.blockHash,
    blockHeight: row.blockHeight,
    bridge: row.bridge,
    contractId: row.contractId,
    counterparty: row.counterparty ?? null,
    detailsAt: row.detailsAt,
    direction: row.direction,
    error: row.error,
    // The fee is the sender's: shown only on what the account sent.
    fee:
      row.payer && row.fee !== null && row.fee !== undefined
        ? u64(row.fee)
        : null,
    fnName: row.fnName,
    gasLimit: row.gasLimit,
    gasPrice: row.gasPrice,
    gasSpent: row.gasSpent,
    hash: row.hash,
    kind: row.kind,
    memo: row.memo ?? "",
    nameCommit: row.nameCommit,
    registeredName: row.registeredName,
    success: row.success ?? null,
    timestamp: row.timestamp ?? null,
    value: u64(row.value),
  };
}

/**
 * The kept history of `account`, newest first, without asking the archive.
 * `coveredTo` is the lowest height down to which the history has no gap;
 * `complete` says it has no gap at all.
 *
 * @param {{
 *   account: string,
 *   before?: number,
 *   limit?: number,
 *   nodeUrl: string,
 *   store?: ActivityStoreModule,
 * }} options
 * @returns {Promise<{ complete: boolean, coveredTo: number | null, entries: ActivityEntry[], meta: ActivityMeta | null }>}
 */
export async function readActivity({
  account,
  before,
  limit = 200,
  nodeUrl,
  store = defaultStore,
}) {
  const ownerKey = store.activityOwnerKey(activityNetworkKey(nodeUrl), account);
  const [meta, rows] = await Promise.all([
    store.getActivityMeta(ownerKey),
    store.listActivityEntries(ownerKey, { before, limit }),
  ]);
  const downTo = meta ? shownDownTo(meta.covered ?? [], meta.target) : null;

  // Only entries above the first gap: below it, newer ones may be missing.
  const entries =
    downTo === null
      ? []
      : rows.filter((row) => row.blockHeight >= downTo).map(activityEntry);

  return { complete: downTo === 0, coveredTo: downTo, entries, meta };
}
