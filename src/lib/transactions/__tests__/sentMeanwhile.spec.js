import { describe, expect, it, vi } from "vitest";

import { timeLabel } from "$lib/activity/present";
import { BALANCE_MASK } from "$lib/constants";

import { readSentMeanwhile, sayMeanwhile } from "../sentMeanwhile";

const ACCOUNT =
  "26dtBf5Lj7C6GccJMeU17JrSEhAarDB6Fvs3MBkCeKVrUXnzXR71MBBvZqih3SB5cwv8t76TWTi7AUMUWL8sBFEGkLabyF2VmALNuf1YYAiaiLitUcKdT4Hwg64pSzxSS93z";
const PROFILE_2 =
  "24ZKdv1CG85AkbdWvPMGFnmNxo8NeDTo1oMvBQPPBvTdhbLQyHTCwNpbQ1wA5U5HQBrU6ukfPHjHieByUn5LuiWyrEhMgdDWfCtvktGrDH2Zpk6afwAXnr4LSHdSboa1GT2s";

/** @param {number} n */
const hashOf = (n) => n.toString(16).padStart(64, "0");

/** @param {string} text */
const hexOf = (text) =>
  Array.from(new TextEncoder().encode(text), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** When the blocks below were made: 10:02 and 10:05. */
const AT_1002 = Date.UTC(2026, 10, 17, 10, 2);
const AT_1005 = Date.UTC(2026, 10, 17, 10, 5);

/** The transfer contract, which says what a transaction paid. */
const TRANSFER = "01".padEnd(64, "0");

/**
 * The chain as the node's GraphQL answers it: the account's transactions
 * in final blocks, as the archive lists them, page by page, each with its
 * moonlight event, of the transfer contract unless `target` says, undone
 * where `reverted`, and its JSON.
 *
 * @param {Array<{ at: number, hash: string, lux?: string, memo?: string, nonce: number, reverted?: boolean, sender?: string, target?: string, to?: string | null }>} sent
 */
function chainOf(sent) {
  return {
    query: vi.fn(async (/** @type {string} */ gql) => {
      if (gql.startsWith("block(height: -1)")) {
        return { block: { header: { height: 4_881_400 } } };
      }

      if (gql.startsWith("out: moonlightHistory(")) {
        const count = Number(/maxCount: (\d+)/.exec(gql)?.[1] ?? Infinity);
        const page = Number(/pageCount: (\d+)/.exec(gql)?.[1] ?? 1);

        return {
          out: {
            json: sent
              .slice((page - 1) * count, page * count)
              .map(
                ({
                  hash,
                  lux = "0",
                  memo = "",
                  reverted,
                  sender,
                  target = TRANSFER,
                  to,
                }) => ({
                  block_height: 4_881_390,
                  events: [
                    {
                      data: {
                        memo: hexOf(memo),
                        receiver: to ?? null,
                        sender: sender ?? ACCOUNT,
                        value: lux,
                      },
                      ...(reverted ? { reverted } : {}),
                      target,
                      topic: "moonlight",
                    },
                  ],
                  origin: hash,
                }),
              ),
          },
        };
      }

      return Object.fromEntries(
        Array.from(
          gql.matchAll(/(t\d+): tx\(hash: "(\w+)"\)/g),
          ([, alias, hash]) => {
            const tx = sent.find((each) => each.hash === hash);

            return [
              alias,
              {
                blockTimestamp: (tx?.at ?? 0) / 1000,
                tx: {
                  json: JSON.stringify({
                    nonce: tx?.nonce,
                    sender: tx?.sender ?? ACCOUNT,
                  }),
                },
              },
            ];
          },
        ),
      );
    }),
  };
}

const meanwhile = {
  account: ACCOUNT,
  from: 199n,
  since: Date.now() - 600_000,
  to: 200n,
};

describe("What an account sent while a send waited", () => {
  it("is read from the chain: its transactions past the nonce known as it was sent, up to the one read since, with amount, whom, memo and time", async () => {
    const network = chainOf([
      { at: AT_1002 - 60_000, hash: hashOf(1), lux: "5", nonce: 199 },
      {
        at: AT_1002,
        hash: hashOf(2),
        lux: "1000000",
        memo: "night shift 9",
        nonce: 200,
        to: PROFILE_2,
      },
      {
        at: AT_1005,
        hash: hashOf(3),
        lux: "9",
        nonce: 200,
        sender: PROFILE_2,
      },
    ]);

    expect(await readSentMeanwhile(network, meanwhile)).toStrictEqual({
      sends: [
        {
          at: AT_1002,
          hash: hashOf(2),
          lux: 1_000_000n,
          memo: "night shift 9",
          nonce: 200n,
          to: PROFILE_2,
        },
      ],
      whole: true,
    });
  });

  // Astra's: the archive lists 50 at a time, oldest first, and an account
  // that sent more since its send waited was never found whole.
  it("is read page by page, past the archive's first fifty, until every nonce asked about is found", async () => {
    const before = Array.from({ length: 60 }, (_, i) => ({
      at: AT_1002 - 600_000 + i,
      hash: hashOf(100 + i),
      lux: "1",
      nonce: 140 + i,
    }));
    const network = chainOf([
      ...before,
      {
        at: AT_1002,
        hash: hashOf(2),
        lux: "1000000",
        memo: "night shift 9",
        nonce: 200,
        to: PROFILE_2,
      },
    ]);

    expect(await readSentMeanwhile(network, meanwhile)).toStrictEqual({
      sends: [
        {
          at: AT_1002,
          hash: hashOf(2),
          lux: 1_000_000n,
          memo: "night shift 9",
          nonce: 200n,
          to: PROFILE_2,
        },
      ],
      whole: true,
    });
  });

  // Astra's: an undone transfer, or another contract's event of that name,
  // read as the same payment, though nothing was paid.
  it("takes only what the transfer contract paid for a payment: not what it undid, nor another contract's event of that name", async () => {
    const payment = {
      address: PROFILE_2,
      lux: 1_000_000n,
      memo: "night shift 9",
    };
    const shown = { hidden: false, locale: "en", nameOf: () => "Profile 2" };

    for (const unpaid of [
      { reverted: true },
      { target: "02".padEnd(64, "0") },
    ]) {
      const network = chainOf([
        {
          at: AT_1002,
          hash: hashOf(2),
          lux: "1000000",
          memo: "night shift 9",
          nonce: 200,
          to: PROFILE_2,
          ...unpaid,
        },
      ]);
      const read = await readSentMeanwhile(network, meanwhile);

      expect(read).toMatchObject({
        sends: [{ hash: hashOf(2), lux: 0n, memo: "", nonce: 200n, to: "" }],
        whole: true,
      });
      expect(sayMeanwhile(read.sends, payment, shown)).toStrictEqual({
        checking: false,
        items: [],
        memo: "",
        same: "",
        title: "Your account sent something else while this waited.",
      });
    }
  });

  it("isn't whole while the archive doesn't list each of them yet", async () => {
    const network = chainOf([
      { at: AT_1002, hash: hashOf(2), lux: "1", nonce: 200, to: PROFILE_2 },
    ]);

    expect(
      await readSentMeanwhile(network, { ...meanwhile, from: 198n }),
    ).toMatchObject({ whole: false });
  });

  const payment = {
    address: PROFILE_2,
    lux: 1_000_000n,
    memo: "night shift 9",
  };
  const shown = {
    hidden: false,
    locale: "en",
    nameOf: (/** @type {string} */ account) =>
      account === PROFILE_2 ? "Profile 2" : "someone",
  };
  const sent = {
    at: AT_1002,
    hash: hashOf(2),
    lux: 1_000_000n,
    memo: "night shift 9",
    nonce: 200n,
    to: PROFILE_2,
  };

  // Lena's, Marek's and Chen's: "something else", when it was the very same
  // payment, and nothing said what or when.
  it("says what was sent, to whom and when, and that it looks like the same payment where it is", () => {
    expect(sayMeanwhile([sent], payment, shown)).toStrictEqual({
      checking: false,
      items: [],
      memo: "",
      same: "That looks like this same payment.",
      title: `Your account sent 0.001 DUSK to Profile 2 at ${timeLabel(AT_1002, "en")} while this waited.`,
    });

    // Another memo: not the same, its memo said.
    expect(
      sayMeanwhile([{ ...sent, memo: "kopi" }], payment, shown),
    ).toStrictEqual({
      checking: false,
      items: [],
      memo: "kopi",
      same: "",
      title: `Your account sent 0.001 DUSK to Profile 2 at ${timeLabel(AT_1002, "en")} while this waited.`,
    });

    // Hidden balances: no amount.
    expect(
      sayMeanwhile([sent], payment, { ...shown, hidden: true }).title,
    ).toBe(
      `Your account sent ${BALANCE_MASK} DUSK to Profile 2 at ${timeLabel(AT_1002, "en")} while this waited.`,
    );
  });

  it("lists each where it sent more, and says one is the same payment where it is", () => {
    const other = { ...sent, at: AT_1005, lux: 7n, memo: "", nonce: 201n };

    expect(sayMeanwhile([sent, other], payment, shown)).toStrictEqual({
      checking: false,
      items: [
        {
          memo: "night shift 9",
          text: `0.001 DUSK to Profile 2 at ${timeLabel(AT_1002, "en")}`,
        },
        {
          memo: "",
          text: `0.000000007 DUSK to Profile 2 at ${timeLabel(AT_1005, "en")}`,
        },
      ],
      memo: "",
      same: "One of them looks like this same payment.",
      title: "Your account sent 2 payments while this waited.",
    });
  });

  it("says only that it sent something else until it's found, or where it called a contract", () => {
    const generic = {
      checking: false,
      items: [],
      memo: "",
      same: "",
      title: "Your account sent something else while this waited.",
    };

    expect(sayMeanwhile(null, payment, shown)).toStrictEqual(generic);
    expect(sayMeanwhile([{ ...sent, to: "" }], payment, shown)).toStrictEqual(
      generic,
    );
    // Found, it's never checking.
    expect(
      sayMeanwhile([{ ...sent, to: "" }], payment, {
        ...shown,
        checking: true,
      }),
    ).toStrictEqual(generic);
  });

  // Chen's and Marek's: "Your account sent something else" for the first ten
  // seconds, Send it too live, of what was the very same payment.
  it("says it's checking what the account sent while that's read, its answers off", () => {
    expect(
      sayMeanwhile(null, payment, { ...shown, checking: true }),
    ).toStrictEqual({
      checking: true,
      items: [],
      memo: "",
      same: "",
      title: "Checking what your account sent…",
    });
  });
});
