/**
 * How many of the account's transactions the archive lists at a time, and
 * how many such pages are read at most: past them, nothing is said.
 */
const PAGE = 50;
const PAGES = 4;

/** A transaction's hash: 64 hex digits. */
const HASH = /^[0-9a-f]{64}$/i;

/**
 * The nonce a transaction's JSON says, as digits, where it's the account's:
 * null for another's, or one without a nonce, as a shielded one.
 *
 * @param {unknown} json
 * @param {string} account
 * @returns {string | null}
 */
function nonceOf(json, account) {
  try {
    const { nonce, sender } = JSON.parse(String(json));

    return sender === account && Number.isSafeInteger(nonce) && nonce >= 0
      ? String(nonce)
      : null;
  } catch {
    return null;
  }
}

/**
 * The transaction of `account` that took `nonce`, as the final blocks from
 * `from` on have it: its hash, and its block's height. The archive lists the
 * account's own transactions there, oldest first, and each one's JSON says
 * its nonce; the nonces read are kept in `known`, by hash, as they never
 * change. Null where none of them took it.
 *
 * @param {Pick<import("@dusk/w3sper").Network, "query">} network
 * @param {{ account: string, from: number, nonce: string }} at
 * @param {{ known?: Map<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<{ blockHeight: number, hash: string } | null>}
 */
export default async function transactionAtNonce(
  network,
  { account, from, nonce },
  { known = new Map(), signal } = {},
) {
  if (!/^\d+$/.test(nonce)) {
    return null;
  }

  const wanted = BigInt(nonce);

  for (let page = 1; page <= PAGES; page += 1) {
    const { out } =
      (await network.query(
        `out: moonlightHistory(sender: ${JSON.stringify(account)}, fromBlock: ${from}, maxCount: ${PAGE}${page > 1 ? `, pageCount: ${page}` : ""}) { json }`,
        { signal },
      )) ?? {};
    /** @type {Array<{ block_height?: unknown, origin?: unknown }>} */
    const listed = Array.isArray(out?.json) ? out.json : [];
    /** @type {Array<{ blockHeight: number, hash: string }>} */
    const sent = listed
      .filter(({ origin }) => HASH.test(String(origin)))
      .map(({ block_height: height, origin }) => ({
        blockHeight: Number(height),
        hash: String(origin).toLowerCase(),
      }));
    const unread = sent.filter(({ hash }) => !known.has(hash));

    if (unread.length) {
      const read =
        (await network.query(
          unread
            .map(({ hash }, i) => `t${i}: tx(hash: "${hash}") { tx { json } }`)
            .join(" "),
          { signal },
        )) ?? {};

      unread.forEach(({ hash }, i) => {
        const its = nonceOf(read[`t${i}`]?.tx?.json, account);

        if (its !== null) {
          known.set(hash, its);
        }
      });
    }

    const taker = sent.find(({ hash }) => known.get(hash) === String(wanted));

    if (taker) {
      return taker;
    }

    // An account's nonces only grow, block by block: past it, no later one
    // has it.
    if (sent.some(({ hash }) => BigInt(known.get(hash) ?? -1) > wanted)) {
      return null;
    }

    if (listed.length < PAGE) {
      return null;
    }
  }

  return null;
}
