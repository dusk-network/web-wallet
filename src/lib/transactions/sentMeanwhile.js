/**
 * What an account sent while one of its sends waited, as the chain has it:
 * its transactions with a nonce past the one the wallet knew as the send
 * was made, up to the one it read since, each with its amount, whom it
 * paid, its memo and its time, from the archive's list of the account's
 * transactions in final blocks, page by page, and from what the transfer
 * contract said of each, as History reads it: what it undid says nothing
 * was paid. A send held as its account sent something
 * else meanwhile says so with them (`sayMeanwhile`), and whether one of them
 * is the same payment. Each is looked up as it's asked, and again for a
 * while where the archive doesn't list them all yet; the history is read
 * again as it's asked, and once they're found, so that it shows them too.
 */

import { TRANSFER_CONTRACT } from "@dusk-network/app-core/history";
import { writable } from "svelte/store";

import { currentActivity } from "$lib/activity";
import { BALANCE_MASK } from "$lib/constants";
import { formatDuskExact } from "$lib/dusk/currency";
import networkStore from "$lib/stores/networkStore";
import { timeLabel } from "$lib/activity/present";

/**
 * What a send held so is asked about: the public account it's sent from,
 * the nonces of what that account sent meanwhile, past `from` up to `to`,
 * and when the send was made.
 *
 * @typedef {{ account: string, from: bigint, since: number, to: bigint }} Meanwhile
 */

/**
 * One transaction its account sent meanwhile: its hash, nonce, the DUSK it
 * moved in Lux, whom it paid (a public account, "" for a call that paid
 * none), its memo, and its block's time.
 *
 * @typedef {{ at: number, hash: string, lux: bigint, memo: string, nonce: bigint, to: string }} SentMeanwhile
 */

/** How many of the account's transactions the archive lists at a time. */
const PAGE = 50;

/** The most pages of them read for one look. */
const PAGES = 20;

/** The fewest seconds a block takes. */
const BLOCK_SECONDS = 10;

/** How many blocks before a send was made the archive is read from. */
const BLOCKS_BEFORE = 30;

/** How long the network gets to answer each time it's asked, in milliseconds. */
const ANSWER_WITHIN = 10_000;

/** How often, and how many times, they're looked up while not all are found. */
const LOOK_EVERY = 5_000;
const LOOKS = 24;

/**
 * How long a send held so says it's checking what its account sent, its
 * answers off, while that isn't found: then it says what's known, and they
 * come on, as the extension does.
 */
export const CHECKING_FOR_MS = 15_000;

/** What a send held so says while what its account sent is being read. */
export const CHECKING_TEXT = "Checking what your account sent…";

/** A transaction's hash: 64 hex digits. */
const HASH = /^[0-9a-f]{64}$/i;

/** @param {Meanwhile} meanwhile */
export const meanwhileKey = ({ account, from, to }) =>
  `${account}:${from}:${to}`;

/** @param {string} hex */
function textOfHex(hex) {
  try {
    return new TextDecoder().decode(
      Uint8Array.from(String(hex).match(/../g) ?? [], (byte) =>
        parseInt(byte, 16),
      ),
    );
  } catch {
    return "";
  }
}

/**
 * The transactions of `account` the archive listed, each with its nonce, as
 * the chain has them: none it can't read, nor another account's.
 *
 * @param {Pick<import("@dusk/w3sper").Network, "query">} network
 * @param {Array<{ events?: unknown, origin?: unknown }>} listed
 * @param {string} account
 * @param {AbortSignal} [signal]
 * @returns {Promise<SentMeanwhile[]>}
 */
async function readListed(network, listed, account, signal) {
  const found = listed.filter(({ origin }) => HASH.test(String(origin)));

  if (!found.length) {
    return [];
  }

  const read =
    (await network.query(
      found
        .map(
          ({ origin }, i) =>
            `t${i}: tx(hash: "${String(origin)}") { blockTimestamp tx { json } }`,
        )
        .join(" "),
      { signal },
    )) ?? {};

  /** @type {SentMeanwhile[]} */
  const sends = [];

  found.forEach(({ events, origin }, i) => {
    const its = read[`t${i}`];
    let json;

    try {
      json = JSON.parse(String(its?.tx?.json));
    } catch {
      return;
    }

    if (json?.sender !== account || !Number.isSafeInteger(json?.nonce)) {
      return;
    }

    // What the transfer contract said it paid, as History reads it: not
    // what it undid, nor what another contract said by the same name.
    /** @type {any} */
    const paid = (Array.isArray(events) ? events : []).find(
      (/** @type {any} */ event) =>
        event?.reverted !== true &&
        String(event?.target ?? "").toLowerCase() === TRANSFER_CONTRACT &&
        event?.topic === "moonlight" &&
        event?.data?.sender === account,
    )?.data;
    const seconds = Number(its?.blockTimestamp);

    sends.push({
      at: Number.isFinite(seconds) ? seconds * 1000 : Date.now(),
      hash: String(origin).toLowerCase(),
      lux: /^\d+$/.test(String(paid?.value ?? "")) ? BigInt(paid.value) : 0n,
      memo: paid?.memo ? textOfHex(paid.memo) : "",
      nonce: BigInt(json.nonce),
      to: typeof paid?.receiver === "string" ? paid.receiver : "",
    });
  });

  return sends;
}

/**
 * What its account sent meanwhile, as the archive lists it now, oldest
 * first: `whole` once every nonce asked about is there. The archive's list
 * is read page by page, from about when the send was made, until every
 * nonce asked about is found, one past them is, or the list ends.
 *
 * @param {Pick<import("@dusk/w3sper").Network, "query">} network
 * @param {Meanwhile} meanwhile
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ sends: SentMeanwhile[], whole: boolean }>}
 */
export async function readSentMeanwhile(network, meanwhile, signal) {
  const { account, from, since, to } = meanwhile;
  const { block } =
    (await network.query("block(height: -1) { header { height } }", {
      signal,
    })) ?? {};
  const tip = Number(block?.header?.height ?? 0);
  const blocksSince = Math.ceil(
    Math.max(0, Date.now() - since) / (BLOCK_SECONDS * 1000),
  );
  const fromBlock = Math.max(0, tip - blocksSince - BLOCKS_BEFORE);

  /** @type {Map<string, SentMeanwhile>} */
  const found = new Map();

  for (let page = 1; page <= PAGES; page += 1) {
    const { out } =
      (await network.query(
        `out: moonlightHistory(sender: ${JSON.stringify(account)}, fromBlock: ${fromBlock}, maxCount: ${PAGE}${page > 1 ? `, pageCount: ${page}` : ""}) { json }`,
        { signal },
      )) ?? {};
    /** @type {Array<{ events?: unknown, origin?: unknown }>} */
    const listed = Array.isArray(out?.json) ? out.json : [];
    const read = await readListed(network, listed, account, signal);

    for (const sent of read) {
      if (sent.nonce > from && sent.nonce <= to) {
        found.set(sent.hash, sent);
      }
    }

    if (
      listed.length < PAGE ||
      BigInt(found.size) >= to - from ||
      read.some(({ nonce }) => nonce > to)
    ) {
      break;
    }
  }

  const sends = [...found.values()].sort((a, b) =>
    a.nonce < b.nonce ? -1 : 1,
  );

  return { sends, whole: BigInt(sends.length) === to - from || to <= from };
}

/**
 * What each account sent meanwhile, by `meanwhileKey`: null until all of it
 * is found.
 *
 * @type {import("svelte/store").Writable<Map<string, SentMeanwhile[] | null>>}
 */
const told = writable(new Map());

/** What each account sent meanwhile, by `meanwhileKey`: null until all of it is found. */
export const sentMeanwhileTold = { subscribe: told.subscribe };

/**
 * What's being read of what each account sent meanwhile, by `meanwhileKey`,
 * for CHECKING_FOR_MS at most, until it's found.
 *
 * @type {import("svelte/store").Writable<Set<string>>}
 */
const checking = writable(new Set());

/**
 * What's being read of what accounts sent meanwhile, by `meanwhileKey`: a
 * send held so says it's checking, its answers off, while its key is here.
 */
export const sentMeanwhileChecking = { subscribe: checking.subscribe };

/**
 * @param {string} key
 * @param {boolean} isChecking
 */
function setChecking(key, isChecking) {
  checking.update((keys) => {
    if (keys.has(key) === isChecking) {
      return keys;
    }

    const next = new Set(keys);

    if (isChecking) {
      next.add(key);
    } else {
      next.delete(key);
    }

    return next;
  });
}

/** The lookups under way or done, by `meanwhileKey`. */
const asked = new Set();

/**
 * Looks up what an account sent while a send waited, once per what's asked:
 * at once, and again while the archive doesn't list it all, for about two
 * minutes. The history is read again as it's asked, and once it's all
 * found, so that it shows it too.
 *
 * @param {Meanwhile} meanwhile
 */
export function followSentMeanwhile(meanwhile) {
  const key = meanwhileKey(meanwhile);

  if (asked.has(key) || meanwhile.to <= meanwhile.from) {
    return;
  }

  asked.add(key);
  told.update((map) => new Map(map).set(key, null));
  setChecking(key, true);
  setTimeout(() => setChecking(key, false), CHECKING_FOR_MS);
  void currentActivity()
    ?.refresh()
    .catch(() => {});

  void (async () => {
    for (let look = 0; look < LOOKS; look += 1) {
      const read = await networkStore
        .connect()
        .then((network) =>
          readSentMeanwhile(
            network,
            meanwhile,
            AbortSignal.timeout(ANSWER_WITHIN),
          ),
        )
        .catch(() => null);

      if (read?.whole) {
        told.update((map) => new Map(map).set(key, read.sends));
        setChecking(key, false);
        void currentActivity()
          ?.refresh()
          .catch(() => {});

        return;
      }

      await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY));
    }

    // Not found whole: asked about again as it's asked next.
    asked.delete(key);
  })();
}

/**
 * Whether what was sent meanwhile is the same payment as the one held: the
 * same amount, to the same account, with the same memo.
 *
 * @param {SentMeanwhile} sent
 * @param {{ address: string, lux: bigint | string, memo: string }} payment
 */
export const isSamePayment = (sent, payment) =>
  sent.to === payment.address &&
  sent.lux === BigInt(payment.lux) &&
  sent.memo === payment.memo;

/**
 * What a send held so says of what its account sent meanwhile: what and to
 * whom, its memo, and when, for one; how many, and each, for more; and
 * whether one of them is the same payment. While that's being read
 * (`checking`), that it's checking, its answers off till it's found, or for
 * CHECKING_FOR_MS at most (Chen's and Marek's: "something else" for the
 * first ten seconds, Send it too live, of what was the same payment); then
 * only something else, where not all of it is found, or one of them paid no
 * account, as a call.
 *
 * @param {SentMeanwhile[] | null | undefined} sends
 * @param {{ address: string, lux: bigint | string, memo: string }} payment
 * @param {{ checking?: boolean, hidden: boolean, locale: string, nameOf: (account: string) => string }} shown
 * @returns {{ checking: boolean, items: Array<{ memo: string, text: string }>, memo: string, same: string, title: string }}
 *   `memo` the memo of the one sent meanwhile, where it's one and not the
 *   same payment; `items` each, where they're more; `same` what's said
 *   where one is the same payment; `checking` while it's read, its answers
 *   off
 */
export function sayMeanwhile(
  sends,
  payment,
  { checking: isChecking = false, hidden, locale, nameOf },
) {
  const described =
    sends?.length && sends.every(({ to }) => to)
      ? sends.map((sent) => ({
          memo: sent.memo,
          text: `${hidden ? BALANCE_MASK : formatDuskExact(sent.lux, locale)} DUSK to ${nameOf(sent.to)} at ${timeLabel(sent.at, locale)}`,
        }))
      : [];
  const isSame = Boolean(
    described.length && sends?.some((sent) => isSamePayment(sent, payment)),
  );

  if (!described.length) {
    return {
      checking: isChecking && !sends,
      items: [],
      memo: "",
      same: "",
      title:
        isChecking && !sends
          ? CHECKING_TEXT
          : "Your account sent something else while this waited.",
    };
  }

  if (described.length === 1) {
    return {
      checking: false,
      items: [],
      memo: isSame ? "" : described[0].memo,
      same: isSame ? "That looks like this same payment." : "",
      title: `Your account sent ${described[0].text} while this waited.`,
    };
  }

  return {
    checking: false,
    items: described,
    memo: "",
    same: isSame ? "One of them looks like this same payment." : "",
    title: `Your account sent ${described.length} payments while this waited.`,
  };
}

/** Forgets what was looked up, as for another wallet. */
export function forgetSentMeanwhile() {
  asked.clear();
  told.set(new Map());
  checking.set(new Set());
}
