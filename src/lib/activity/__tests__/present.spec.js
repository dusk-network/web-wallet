import { describe, expect, it } from "vitest";

import { claimDay } from "$lib/bridge/claimDate";

import {
  CSV_COLUMNS,
  CSV_CONTACT_COLUMN,
  claimedWithdrawals,
  dayLabel,
  describeRow,
  groupByDay,
  isStakingRow,
  matchesFilters,
  toCsv,
} from "../present";

const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const BRIDGE = `0x${"ab".repeat(32)}`;
const context = {
  bridgeContracts: new Set(["ab".repeat(32)]),
  locale: "en",
};

/**
 * @param {Partial<ActivityRow>} fields
 * @returns {ActivityRow}
 */
const row = (fields) => ({
  amount: "25000000000",
  blockHeight: 4_687_000,
  direction: "out",
  hash: "aa".repeat(32),
  kind: "transfer",
  privacy: "public",
  source: "archive",
  status: "executed",
  success: true,
  timestamp: Date.UTC(2026, 9, 26, 13, 32),
  to: ACCOUNT,
  ...fields,
});

describe("describeRow", () => {
  it("names a counterparty saved as a contact by the contact's name, its .dusk name second", () => {
    const contactNames = new Map([[ACCOUNT, "Alice"]]);

    expect(
      describeRow(row({ counterpartyName: "alice-shop.dusk" }), {
        ...context,
        contactNames,
      })
    ).toMatchObject({
      title: "Alice · alice-shop.dusk",
      titleIsAddress: false,
    });
    expect(describeRow(row({}), { ...context, contactNames }).title).toBe(
      "Alice"
    );
    expect(
      describeRow(row({ direction: "in", from: ACCOUNT, to: undefined }), {
        ...context,
        contactNames,
      })
    ).toMatchObject({ line: "Received", title: "Alice" });
  });

  it("shows an amount in the one format, and in full for a hover", () => {
    expect(
      describeRow(row({ amount: "1234567891234" }), context).amount
    ).toMatchObject({ exact: "1,234.567891234", text: "1,234.5678" });
  });

  it("names a transfer by its counterparty's verified name, or its short address", () => {
    expect(
      describeRow(row({ counterpartyName: "alice-shop.dusk" }), context)
    ).toMatchObject({
      amount: { exact: "25", muted: false, sign: "−", text: "25" },
      category: "sent",
      icon: "sent",
      line: "Sent",
      privacy: "Public",
      status: null,
      title: "alice-shop.dusk",
      titleIsAddress: false,
    });
    expect(describeRow(row({}), context)).toMatchObject({
      title: `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)}`,
      titleIsAddress: true,
    });
    expect(
      describeRow(
        row({ direction: "in", from: ACCOUNT, to: undefined }),
        context
      )
    ).toMatchObject({
      amount: { sign: "+" },
      category: "received",
      icon: "received",
      line: "Received",
    });
  });

  it("shows a failed transaction moved nothing: no sign, muted, and the fee it cost", () => {
    expect(
      describeRow(
        row({ feePaid: "3700000", status: "failed", success: false }),
        context
      )
    ).toMatchObject({
      amount: { muted: true, sign: "", text: "25" },
      line: "Failed · nothing sent · fee 0.0037 DUSK paid",
      status: "failed",
    });

    // A fee paid rounds to the nearest of four decimals.
    expect(
      describeRow(
        row({ feePaid: "1853542", status: "failed", success: false }),
        context
      ).line
    ).toBe("Failed · nothing sent · fee 0.0019 DUSK paid");
    expect(
      describeRow(
        row({ source: "local", status: "failed", success: undefined }),
        context
      ).line
    ).toBe("Failed · nothing sent · no fee");
  });

  it("shows a status only while a transaction isn't final", () => {
    expect(
      describeRow(row({ source: "local", status: "submitted" }), context).status
    ).toBe("pending");
    expect(
      describeRow(row({ source: "local", status: "unknown" }), context).status
    ).toBe("unknown");

    // An archive entry is final: only its outcome isn't looked up yet.
    expect(
      describeRow(row({ status: "unknown", success: null }), context).status
    ).toBeNull();
  });

  it("names staking, shielding and the bridge by what they did", () => {
    expect(describeRow(row({ kind: "stake" }), context)).toMatchObject({
      category: "staking",
      line: "Staking",
      title: "Staked",
    });
    expect(
      describeRow(row({ direction: "in", kind: "withdraw_reward" }), context)
    ).toMatchObject({ category: "staking", title: "Rewards claimed" });
    expect(describeRow(row({ kind: "shield" }), context)).toMatchObject({
      amount: { sign: "" },
      line: "Public to shielded",
      title: "Shielded",
    });
    expect(
      describeRow(
        row({ contractId: BRIDGE, kind: "contract_call", to: undefined }),
        context
      )
    ).toMatchObject({
      category: "bridge",
      line: "Bridge",
      title: "To DuskEVM",
    });
    expect(
      describeRow(
        row({
          amount: "0",
          contractId: BRIDGE,
          fnName: "proveWithdrawalTransaction",
          kind: "contract_call",
        }),
        context
      )
    ).toMatchObject({ title: "Withdrawal proved" });
    expect(
      describeRow(
        row({ contractId: BRIDGE, direction: "in", kind: "contract_call" }),
        context
      ).title
    ).toBe("From DuskEVM");
  });

  it("names a call to Dusk Domains by what it did", () => {
    const store =
      "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

    expect(
      describeRow(
        row({
          amount: "10000000000",
          contractId: store,
          fnName: "register",
          kind: "contract_call",
          to: undefined,
        }),
        { ...context, network: "testnet" }
      )
    ).toMatchObject({
      amount: { sign: "−", text: "10" },
      icon: "call",
      line: "Dusk Domains",
      title: "Registered a .dusk name",
    });
  });

  it("says where a bridge row's DUSK went: the DuskEVM address, or the withdrawal and its next step", () => {
    const evm = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
    const withdrawal = "0001".padEnd(64, "0");
    const hash = /** @type {`0x${string}`} */ (`0x${"8e".repeat(32)}`);
    const proved = row({
      amount: "0",
      bridge: { amount: "1008000000000", hash, kind: "prove", withdrawal },
      contractId: BRIDGE,
      fnName: "proveWithdrawalTransaction",
      kind: "contract_call",
      to: undefined,
    });
    const claim = row({
      amount: "0",
      bridge: { amount: "1008000000000", hash, kind: "claim", withdrawal },
      contractId: BRIDGE,
      fnName: "finalizeWithdrawalTransaction",
      hash: "bb".repeat(32),
      kind: "contract_call",
      to: undefined,
    });
    // When the chain says it can be claimed: Mon 2 Nov 2026, 03:20:39 UTC.
    const at = Date.UTC(2026, 10, 2, 3, 20, 39);
    const day = claimDay(at, "en");
    /** @param {Record<string, unknown>} read */
    const claims = (read) =>
      new Map([
        [
          hash,
          {
            at,
            claimed: false,
            exact: false,
            overdue: false,
            ready: false,
            ...read,
          },
        ],
      ]);

    expect(
      describeRow(
        row({
          bridge: { amount: "25000000000", kind: "deposit", to: evm },
          contractId: BRIDGE,
          kind: "contract_call",
          to: undefined,
        }),
        context
      )
    ).toMatchObject({
      amount: { sign: "−", text: "25" },
      counterparty: evm,
      line: "Bridge · to 0x19E7…DAff2A",
      note: null,
      shortLine: "Bridge · to 0x19E7…DAff2A",
      title: "To DuskEVM",
    });

    // Proved, not claimed: the amount on its way, muted. No date is made up
    // from a fixed wait: none until the chain has been read.
    expect(describeRow(proved, context)).toMatchObject({
      amount: { muted: true, sign: "", text: "1,008" },
      line: "Bridge",
      note: null,
      title: "Withdrawal proved",
      withdrawal: { claim: null, claimed: false, ready: false },
    });

    // Then when it can be claimed, as the chain says: about, until its
    // game has resolved.
    const waiting = describeRow(proved, { ...context, claims: claims({}) });

    expect(waiting).toMatchObject({
      line: `Bridge · claim from about ${day}`,
      withdrawal: { claim: { at, exact: false, overdue: false } },
    });
    // Where a row is narrow, the claim date gets a line of its own.
    expect(waiting.note).toBe(`Claim from about ${day}`);
    expect(waiting.shortLine).toBe("Bridge");
    expect(
      describeRow(proved, { ...context, claims: claims({ exact: true }) }).line
    ).toBe(`Bridge · claim from ${day}`);
    expect(
      describeRow(proved, { ...context, claims: claims({ overdue: true }) })
        .note
    ).toBe(
      `Waiting for DuskEVM to settle this proof. Claim from ${day} at the soonest.`
    );
    expect(
      describeRow(proved, { ...context, claims: claims({ ready: true }) })
    ).toMatchObject({
      line: "Bridge · ready to claim",
      note: "Ready to claim",
      withdrawal: { ready: true },
    });

    // Claimed: by a row of this history, or as the Portal says.
    const claimed = claimedWithdrawals([claim, proved]);

    for (const known of [
      { ...context, claimed },
      { ...context, claims: claims({ at: null, claimed: true }) },
    ]) {
      expect(describeRow(proved, known)).toMatchObject({
        amount: { muted: false, text: "1,008" },
        line: "Bridge · claimed",
        note: null,
        shortLine: "Bridge · claimed",
        withdrawal: { claimed: true },
      });
    }

    expect(describeRow(claim, context)).toMatchObject({
      amount: { text: "1,008" },
      title: "Withdrawal claimed",
      withdrawal: null,
    });
    expect(
      claimedWithdrawals([{ ...claim, status: "failed", success: false }])
    ).toEqual(new Set());

    // A call to the bridge that didn't read as one of its calls reads as before.
    expect(describeRow({ ...proved, bridge: null }, context)).toMatchObject({
      amount: { text: "0" },
      line: "Bridge",
      withdrawal: null,
    });
  });

  it("names a stake with Sozu and an unstake from it as staking, and no other contract's calls of the same name", () => {
    const pool =
      "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
    const call = {
      contractId: pool,
      kind: /** @type {const} */ ("contract_call"),
      to: undefined,
    };
    const staked = row({ ...call, fnName: "sozu_stake" });
    const unstaked = row({ ...call, direction: "in", fnName: "sozu_unstake" });
    const lookalike = row({
      ...call,
      contractId: "cd".repeat(32),
      fnName: "sozu_stake",
    });

    expect(describeRow(staked, context)).toMatchObject({
      amount: { sign: "−", text: "25" },
      category: "staking",
      icon: "staking",
      line: "Liquid staking",
      title: "Staked with Sozu",
    });
    expect(describeRow(unstaked, context)).toMatchObject({
      amount: { sign: "+" },
      category: "staking",
      title: "Unstaked from Sozu",
    });
    expect(describeRow(lookalike, context)).toMatchObject({
      category: "sent",
      icon: "call",
      title: "Called sozu_stake",
    });
    expect(
      [staked, unstaked, lookalike].map((one) => isStakingRow(one))
    ).toStrictEqual([true, true, false]);
    expect(isStakingRow(row({ kind: "unstake" }))).toBe(true);

    // A pool Sozu's hub named, as a view that follows them passes it.
    const named = new Set([lookalike.contractId ?? ""]);

    expect(isStakingRow(lookalike, named)).toBe(true);
    expect(
      describeRow(lookalike, { ...context, sozuPools: named })
    ).toMatchObject({ category: "staking", title: "Staked with Sozu" });
  });

  it("says a shielded row is shielded", () => {
    expect(describeRow(row({ privacy: "shielded" }), context).privacy).toBe(
      "Shielded"
    );
  });
});

describe("matchesFilters", () => {
  const sent = row({});
  const staked = row({ kind: "stake" });

  it("filters by what a row did, its privacy and its date", () => {
    const p = describeRow(sent, context);

    expect(matchesFilters(p, sent, { kind: "sent" })).toBe(true);
    expect(matchesFilters(p, sent, { kind: "received" })).toBe(false);
    expect(
      matchesFilters(describeRow(staked, context), staked, { kind: "staking" })
    ).toBe(true);
    expect(matchesFilters(p, sent, { privacy: "shielded" })).toBe(false);
    expect(matchesFilters(p, sent, { since: Date.UTC(2026, 9, 27) })).toBe(
      false
    );
    expect(matchesFilters(p, sent, { since: Date.UTC(2026, 9, 1) })).toBe(true);
  });
});

describe("dayLabel and groupByDay", () => {
  const now = new Date(2026, 9, 26, 15, 0).getTime();

  it("calls today and yesterday by name, and other days by their date", () => {
    expect(
      dayLabel(new Date(2026, 9, 26, 9).getTime(), { locale: "en", now })
    ).toBe("Today");
    expect(
      dayLabel(new Date(2026, 9, 25, 9).getTime(), { locale: "en", now })
    ).toBe("Yesterday");
    expect(
      dayLabel(new Date(2026, 9, 24, 9).getTime(), { locale: "en", now })
    ).toBe("Sat, Oct 24");
    expect(
      dayLabel(new Date(2026, 9, 26, 9).getTime(), {
        full: true,
        locale: "en",
        now,
      })
    ).toBe("Today · Mon, Oct 26");
  });

  it("names yesterday from the calendar, across a clock change", () => {
    const zone = process.env.TZ;

    // The clocks went forward on Sunday 29 March 2026: 24 hours before
    // Monday 00:30 is Saturday 23:30.
    process.env.TZ = "Europe/Amsterdam";

    try {
      const monday = new Date(2026, 2, 30, 0, 30).getTime();

      expect(
        dayLabel(new Date(2026, 2, 29, 12).getTime(), {
          locale: "en",
          now: monday,
        })
      ).toBe("Yesterday");
      expect(
        dayLabel(new Date(2026, 2, 28, 23, 45).getTime(), {
          locale: "en",
          now: monday,
        })
      ).toBe("Sat, Mar 28");
    } finally {
      if (zone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = zone;
      }
    }
  });

  it("groups rows by day as they come, and rows without a time last", () => {
    const times = [
      new Date(2026, 9, 26, 14).getTime(),
      null,
      new Date(2026, 9, 26, 9).getTime(),
      new Date(2026, 9, 24, 9).getTime(),
    ];
    const groups = groupByDay(times, (time) => time, { locale: "en", now });

    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Today", 2],
      ["Sat, Oct 24", 1],
      ["Time not known yet", 1],
    ]);
  });
});

describe("toCsv", () => {
  it("keeps every decimal, without grouping", () => {
    const [, line] = toCsv(
      [row({ amount: "1234567891234", feePaid: "1853542" })],
      context
    ).split("\r\n");

    expect(line).toContain(",-1234.567891234,0.001853542,");
  });

  it("holds a line per row, failed ones with nothing moved and the fee on its own", () => {
    const csv = toCsv(
      [
        row({ counterpartyName: "alice-shop.dusk", memo: "Order 1042" }),
        row({
          feePaid: "3700000",
          hash: "bb".repeat(32),
          memo: "=HYPERLINK(1)",
          status: "failed",
          success: false,
        }),
      ],
      context
    ).split("\r\n");

    expect(csv[0]).toBe(CSV_COLUMNS.join(","));
    expect(csv[1]).toContain(`2026-10-26T13:32:00.000Z`);
    expect(csv[1]).toContain(`,${"aa".repeat(32)},out,Public,`);
    expect(csv[1]).toContain(
      `,alice-shop.dusk,${ACCOUNT},-25,,Order 1042,Completed`
    );

    // A memo is never read as a formula.
    expect(csv[2]).toContain(`,0,0.0037,'=HYPERLINK(1),Failed`);
  });

  it("keeps the user's contact names out, unless asked, and then in their own column", () => {
    const rows = [row({ counterpartyName: "alice-shop.dusk" })];
    const withNames = {
      ...context,
      contactNames: new Map([[ACCOUNT, "Alice (landlord, private)"]]),
    };
    const plain = toCsv(rows, withNames);
    const asked = toCsv(rows, withNames, { withContacts: true }).split("\r\n");

    expect(plain).not.toContain("landlord");
    expect(plain).toContain(",alice-shop.dusk (Sent),");
    expect(asked[0]).toBe([...CSV_COLUMNS, CSV_CONTACT_COLUMN].join(","));
    expect(asked[1]).toContain(",alice-shop.dusk (Sent),");
    expect(asked[1]).toMatch(/,Completed,"Alice \(landlord, private\)"$/);
  });

  it("marks a row not looked up yet, and leaves an undated one out of a range of days", () => {
    const pending = row({
      status: "unknown",
      success: null,
      timestamp: undefined,
    });
    const [, line] = toCsv([pending], context).split("\r\n");

    expect(line).toMatch(/^,,4687000,/);
    expect(line).toMatch(/,Not looked up yet$/);
    expect(
      matchesFilters(describeRow(pending, context), pending, { since: 0 })
    ).toBe(false);
    expect(matchesFilters(describeRow(pending, context), pending, {})).toBe(
      true
    );
  });
});
