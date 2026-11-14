import { describe, expect, it, vi } from "vitest";

import transactionAtNonce from "../transactionAtNonce";

const ACCOUNT =
  "26dtBf5Lj7C6GccJMeU17JrSEhAarDB6Fvs3MBkCeKVrUXnzXR71MBBvZqih3SB5cwv8t76TWTi7AUMUWL8sBFEGkLabyF2VmALNuf1YYAiaiLitUcKdT4Hwg64pSzxSS93z";
const OTHER =
  "24ZKdv1CG85AkbdWvPMGFnmNxo8NeDTo1oMvBQPPBvTdhbLQyHTCwNpbQ1wA5U5HQBrU6ukfPHjHieByUn5LuiWyrEhMgdDWfCtvktGrDH2Zpk6afwAXnr4LSHdSboa1GT2s";

/** @param {number} n */
const hashOf = (n) => n.toString(16).padStart(64, "0");

/**
 * The chain as the node's GraphQL answers it: the account's transactions,
 * oldest first, as the archive lists them, 50 a page, each with its JSON.
 *
 * @param {Array<{ hash: string, height: number, nonce: number, sender?: string }>} sent
 */
function chainOf(sent) {
  return {
    query: vi.fn(async (/** @type {string} */ gql) => {
      const history = gql.match(
        /^out: moonlightHistory\(sender: "(\w+)", fromBlock: (\d+), maxCount: 50(?:, pageCount: (\d+))?\) \{ json \}$/
      );

      if (history) {
        const [, sender, from, page = "1"] = history;
        const listed = sent.filter(
          (tx) => (tx.sender ?? ACCOUNT) === sender && tx.height >= +from
        );

        return {
          out: {
            json: listed
              .slice((+page - 1) * 50, +page * 50)
              .map(({ hash, height }) => ({
                block_height: height,
                events: [],
                origin: hash,
              })),
          },
        };
      }

      return Object.fromEntries(
        Array.from(
          gql.matchAll(/(t\d+): tx\(hash: "(\w+)"\) \{ tx \{ json \} \}/g),
          ([, alias, hash]) => {
            const tx = sent.find((each) => each.hash === hash);

            return [
              alias,
              tx
                ? {
                    tx: {
                      json: JSON.stringify({
                        nonce: tx.nonce,
                        sender: tx.sender ?? ACCOUNT,
                        type: "moonlight",
                      }),
                    },
                  }
                : null,
            ];
          }
        )
      );
    }),
  };
}

describe("transactionAtNonce", () => {
  it("finds the account's transaction that took a nonce, in a final block, with its block", async () => {
    const chain = chainOf([
      { hash: hashOf(1), height: 100, nonce: 105 },
      { hash: hashOf(2), height: 104, nonce: 106 },
      { hash: hashOf(3), height: 110, nonce: 107 },
      { hash: hashOf(4), height: 111, nonce: 108 },
    ]);

    await expect(
      transactionAtNonce(chain, { account: ACCOUNT, from: 90, nonce: "107" })
    ).resolves.toStrictEqual({ blockHeight: 110, hash: hashOf(3) });
  });

  it("says none where no transaction of the account took it yet, nor where only later nonces are seen: a nonce that moved on isn't one taken", async () => {
    const none = chainOf([{ hash: hashOf(1), height: 100, nonce: 106 }]);
    const later = chainOf([
      { hash: hashOf(1), height: 100, nonce: 106 },
      { hash: hashOf(2), height: 120, nonce: 109 },
    ]);

    await expect(
      transactionAtNonce(none, { account: ACCOUNT, from: 90, nonce: "107" })
    ).resolves.toBeNull();
    await expect(
      transactionAtNonce(later, { account: ACCOUNT, from: 110, nonce: "107" })
    ).resolves.toBeNull();
  });

  it("takes only the account's own transactions, by what their JSON says", async () => {
    const chain = chainOf([
      { hash: hashOf(1), height: 100, nonce: 107, sender: OTHER },
    ]);
    // The archive listing another account's, as if it were this one's.
    const query = chain.query.getMockImplementation();

    chain.query.mockImplementation(async (gql) =>
      /** @type {NonNullable<typeof query>} */ (query)(
        gql.replace(ACCOUNT, OTHER)
      )
    );

    await expect(
      transactionAtNonce(chain, { account: ACCOUNT, from: 0, nonce: "107" })
    ).resolves.toBeNull();
  });

  it("reads the pages it needs, the nonces once, and none past the nonce", async () => {
    const sent = Array.from({ length: 120 }, (_, i) => ({
      hash: hashOf(i + 1),
      height: 1000 + i,
      nonce: i + 1,
    }));
    const chain = chainOf(sent);
    const known = new Map();

    await expect(
      transactionAtNonce(
        chain,
        { account: ACCOUNT, from: 1000, nonce: "75" },
        { known }
      )
    ).resolves.toStrictEqual({ blockHeight: 1074, hash: hashOf(75) });

    // Two pages, each listed, then read: 100 nonces kept.
    expect(chain.query).toHaveBeenCalledTimes(4);
    expect(known.size).toBe(100);

    // Asked again, only the listing: the nonces are known.
    chain.query.mockClear();

    await expect(
      transactionAtNonce(
        chain,
        { account: ACCOUNT, from: 1000, nonce: "75" },
        { known }
      )
    ).resolves.toStrictEqual({ blockHeight: 1074, hash: hashOf(75) });
    expect(chain.query).toHaveBeenCalledTimes(2);

    // Past it on the first page: no second page is read.
    chain.query.mockClear();

    await expect(
      transactionAtNonce(
        chain,
        { account: ACCOUNT, from: 1010, nonce: "3" },
        { known }
      )
    ).resolves.toBeNull();
    expect(chain.query).toHaveBeenCalledTimes(1);
  });

  it("says none for a send without a nonce, as a shielded one, asking nothing", async () => {
    const chain = chainOf([]);

    await expect(
      transactionAtNonce(chain, { account: ACCOUNT, from: 0, nonce: "" })
    ).resolves.toBeNull();
    expect(chain.query).not.toHaveBeenCalled();
  });
});
