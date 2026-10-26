import { describe, expect, it } from "vitest";

import {
  CSV_COLUMNS,
  dayLabel,
  describeRow,
  groupByDay,
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
});
