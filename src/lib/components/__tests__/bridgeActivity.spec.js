import { describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { cardRoutes } from "$lib/bridge/cardRoutes";
import { claimDay } from "$lib/bridge/claimDate";

import {
  BRIDGE_ACTIVITY_GROUPS,
  depositRow,
  groupBridgeActivity,
  routeTransferRow,
  withdrawalDuskTransactions,
  withdrawalRow,
} from "../EvmTransactions/bridgeActivity";

const SENT = Date.UTC(2026, 9, 26, 4, 49);
const CLAIM_AT = Date.UTC(2026, 10, 2, 3, 20, 39);
const options = { locale: "en" };

/** The Dusk account the activity is of, and another one. */
const OWN =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const OTHER =
  "213qXNJXsQEGigeKJ8jFxuaPb1UV2BiGNykjS3cqRULiaBjQQcGQyEknV7WAhNF5u9hhhFoJcLxbuMWuWhCq3b9jCHDTpvGZaV5HcUU8Z5c4oHbdJ7TQ1NWQJNghYV5JJ9Y";

/**
 * @param {string} stage
 * @param {Record<string, unknown>} [fields]
 */
const withdrawal = (stage, fields = {}) => ({
  amountWei: "1000000000000000000",
  createdAt: SENT,
  sentAt: new Date(SENT).toISOString(),
  stage,
  transactionHash: `0x${"5a".repeat(32)}`,
  ...fields,
});

/**
 * @param {string} stage
 * @param {Record<string, unknown>} [fields]
 */
const deposit = (stage, fields = {}) => ({
  account: null,
  amountLux: "100000000",
  amountWei: null,
  createdAt: SENT,
  failureLayer: null,
  progressedAt: Date.now(),
  stage,
  transactionHash: "ab".repeat(32),
  ...fields,
});

describe("routeTransferRow", () => {
  it("lists a migration known only by its payout when it was paid, saying so", () => {
    const route = /** @type {import("$lib/bridge/cardRoutes").CardRoute} */ (
      cardRoutes(networks.mainnet).find(({ id }) => id === "bsc-to-dusk")
    );

    expect(
      routeTransferRow(
        {
          amountLux: 4_000_000_000n,
          at: null,
          hash: `0x${"bf".repeat(32)}`,
          kind: "migration",
          paidAt: CLAIM_AT,
          payout: "5c".repeat(32),
          recipient: "",
          route,
          stage: "paid",
        },
        options
      )
    ).toMatchObject({
      group: "done",
      line: `Paid ${claimDay(CLAIM_AT, "en")}`,
      when: CLAIM_AT,
    });
  });
});

describe("withdrawalRow", () => {
  it("should name a withdrawal by its route and amount, with what it needs next", () => {
    expect(withdrawalRow(withdrawal("ready_to_finalize"), options)).toEqual(
      expect.objectContaining({
        action: "claim",
        amount: "1 DUSK",
        from: "duskEvm",
        group: "needs",
        line: "Ready to claim on Dusk",
        state: "",
        title: "DuskEVM to Dusk",
        to: "duskDs",
        when: SENT,
      })
    );
    expect(withdrawalRow(withdrawal("ready_to_prove"), options)).toEqual(
      expect.objectContaining({
        action: "prove",
        group: "needs",
        line: "Ready to prove on Dusk",
      })
    );
  });

  it("should give a waiting withdrawal its claim date, as the chain says it", () => {
    const waiting = withdrawal("proven_waiting", {
      readyAt: String(CLAIM_AT / 1_000),
      readyAtExact: false,
    });

    expect(withdrawalRow(waiting, options)).toEqual(
      expect.objectContaining({
        action: null,
        group: "progress",
        line: `Claim from about ${claimDay(CLAIM_AT, "en")}`,
        state: "Pending",
      })
    );
    expect(
      withdrawalRow({ ...waiting, readyAtExact: true }, options).line
    ).toBe(`Claim from ${claimDay(CLAIM_AT, "en")}`);
    expect(
      withdrawalRow({ ...waiting, proofRejected: true }, options).line
    ).toBe("Proof rejected · prove it again once DuskEVM reports a new output");
    // No date made up before the chain gives one.
    expect(withdrawalRow(withdrawal("proven_waiting"), options).line).toBe(
      "Proved, not claimable yet"
    );
  });

  it("should say what a withdrawal waits for before its proof, and after a step was sent", () => {
    expect(withdrawalRow(withdrawal("submitted"), options).line).toBe(
      `Sent ${claimDay(SENT, "en")}`
    );
    expect(
      withdrawalRow(
        withdrawal("submitted", { sentAt: null, timestamp: null }),
        options
      ).line
    ).toBe("Sent");
    expect(withdrawalRow(withdrawal("waiting_for_output"), options).line).toBe(
      "Not on Dusk yet · usually within an hour"
    );
    expect(
      withdrawalRow(withdrawal("waiting_for_output"), {
        ...options,
        time: { prove: 3_600, seconds: 0, source: "chain" },
      }).line
    ).toBe(`Prove from about ${claimDay(SENT + 3_600_000, "en")}`);
    expect(withdrawalRow(withdrawal("prove_submitted"), options).line).toBe(
      "Proof sent, waiting for Dusk"
    );
    expect(withdrawalRow(withdrawal("finalize_submitted"), options).line).toBe(
      "Claim sent, waiting for Dusk"
    );
  });

  it("should put a claimed withdrawal under done, and a failed one under what didn't go through", () => {
    expect(withdrawalRow(withdrawal("finalized"), options)).toEqual(
      expect.objectContaining({
        group: "done",
        line: "Claimed on Dusk",
        state: "",
      })
    );
    expect(withdrawalRow(withdrawal("failed"), options)).toEqual(
      expect.objectContaining({
        group: "failed",
        line: "The DUSK is still on DuskEVM",
        state: "Failed",
      })
    );
  });

  it("should put a withdrawal that pays someone else in a group of its own, saying whom, with its step offered quietly", () => {
    const theirs = withdrawalRow(
      withdrawal("ready_to_prove", { recipient: OTHER }),
      {
        ...options,
        account: OWN,
      }
    );

    expect(theirs).toEqual(
      expect.objectContaining({
        action: "prove",
        forOther: true,
        group: "other",
        line: "Pays 213qXN…V5JJ9Y · ready to prove on Dusk",
        state: "",
      })
    );
    expect(
      withdrawalRow(withdrawal("proven_waiting", { recipient: OTHER }), {
        ...options,
        account: OWN,
      })
    ).toEqual(expect.objectContaining({ group: "other", state: "Pending" }));

    // Done or failed, it goes where all of those go, still saying whom.
    expect(
      withdrawalRow(withdrawal("finalized", { recipient: OTHER }), {
        ...options,
        account: OWN,
      })
    ).toEqual(
      expect.objectContaining({
        group: "done",
        line: "Pays 213qXN…V5JJ9Y · claimed on Dusk",
      })
    );

    // A contract it pays is said to be one.
    expect(
      withdrawalRow(
        withdrawal("ready_to_prove", { recipient: "21a5cb".padEnd(64, "0") }),
        { ...options, account: OWN }
      ).line
    ).toBe("Pays contract 21a5cb…000000 · ready to prove on Dusk");

    // One that pays the account, or whose recipient isn't known: as ever.
    for (const recipient of [OWN, null]) {
      expect(
        withdrawalRow(withdrawal("ready_to_prove", { recipient }), {
          ...options,
          account: OWN,
        })
      ).toEqual(
        expect.objectContaining({
          forOther: false,
          group: "needs",
          line: "Ready to prove on Dusk",
        })
      );
    }
  });

  it("should leave a withdrawal that pays someone else where its step puts it once this account proved it, still saying whom", () => {
    const hash = `0x${"4b".repeat(32)}`;
    /**
     * @param {string} stage
     * @param {Record<string, unknown>} [fields]
     * @param {Map<string, { prove?: string }>} [steps]
     */
    const row = (stage, fields = {}, steps = undefined) =>
      withdrawalRow(
        withdrawal(stage, {
          recipient: OTHER,
          withdrawalHash: hash,
          ...fields,
        }),
        { ...options, account: OWN, steps }
      );

    // Its reads, which are this account's, say it proved it: the claim is
    // this account's to make.
    expect(row("ready_to_finalize")).toEqual(
      expect.objectContaining({
        action: "claim",
        forOther: false,
        group: "needs",
        line: "Pays 213qXN…V5JJ9Y · ready to claim on Dusk",
      })
    );
    expect(row("proven_waiting")).toEqual(
      expect.objectContaining({
        forOther: false,
        group: "progress",
        state: "Pending",
      })
    );

    // Or they found this account's proof, refused and to be proved again,
    // whether or not the history loaded has it.
    expect(
      row("ready_to_prove", { proofGame: `0x${"1e".repeat(20)}` })
    ).toEqual(
      expect.objectContaining({
        action: "prove",
        forOther: false,
        group: "needs",
        line: "Pays 213qXN…V5JJ9Y · ready to prove on Dusk",
      })
    );

    // Or the account's history has its proof, before any read.
    expect(
      row("submitted", {}, new Map([[hash, { prove: "ab".repeat(32) }]]))
    ).toEqual(expect.objectContaining({ forOther: false, group: "progress" }));

    // Not proved here: by nobody yet, or by another account, which leaves
    // this account's reads short of a proof; or at a stage only the explorer
    // gave, which could be anyone's proof.
    expect(row("ready_to_prove", { proofSubmitterCount: 1n })).toEqual(
      expect.objectContaining({ forOther: true, group: "other" })
    );
    expect(row("proven_waiting", { withdrawalHash: null })).toEqual(
      expect.objectContaining({ forOther: true, group: "other" })
    );
  });

  it("should leave out an amount it doesn't know", () => {
    expect(
      withdrawalRow(withdrawal("submitted", { amountWei: null }), options)
        .amount
    ).toBe("");
  });
});

describe("depositRow", () => {
  it("should name a deposit by its route and amount, sent when, and how long it takes", () => {
    expect(depositRow(deposit("l1_pending"), options)).toEqual(
      expect.objectContaining({
        action: null,
        amount: "0.1 DUSK",
        from: "duskDs",
        group: "progress",
        line: `Sent ${claimDay(SENT, "en")}`,
        state: "Pending",
        title: "Dusk to DuskEVM",
        to: "duskEvm",
      })
    );
    expect(
      depositRow(deposit("l2_pending", { l1ConfirmedAt: Date.now() }), {
        ...options,
        time: { seconds: 60, source: "chain" },
      }).line
    ).toBe(`Sent ${claimDay(SENT, "en")} · takes ~1 min`);
    // Arrived, when DuskEVM's explorer says, and where.
    expect(depositRow(deposit("completed"), options)).toEqual(
      expect.objectContaining({
        group: "done",
        line: "Arrived on DuskEVM",
        state: "",
      })
    );
    expect(
      depositRow(
        deposit("completed", {
          account: "0xab84edffd745af9420ac74fec73121fbee9fc86f",
          arrivedAt: SENT + 60_000,
        }),
        options
      ).line
    ).toBe(`Arrived ${claimDay(SENT + 60_000, "en")} · to 0xAB84…C86F`);
    expect(
      depositRow(
        deposit("l1_pending", {
          account: "0xab84edffd745af9420ac74fec73121fbee9fc86f",
        }),
        options
      ).line
    ).toBe(`Sent ${claimDay(SENT, "en")} · to 0xAB84…C86F`);
  });

  it("should say a deposit takes longer than usual, or why it didn't go through", () => {
    expect(
      depositRow(deposit("l2_pending", { l1ConfirmedAt: SENT }), options).line
    ).toBe(`Sent ${claimDay(SENT, "en")} · taking longer than usual`);
    expect(
      depositRow(deposit("failed", { failureLayer: "l1" }), options)
    ).toEqual(
      expect.objectContaining({
        group: "failed",
        line: "The DUSK didn't leave Dusk",
        state: "Failed",
      })
    );
    expect(
      depositRow(deposit("failed", { failureLayer: "l2" }), options).line
    ).toBe("Delivery failed on DuskEVM · don't send it again");
  });
});

describe("groupBridgeActivity", () => {
  it("should list what needs you first, then what's under way, what pays someone else, done and failed, each newest first, leaving out empty groups", () => {
    const rows = [
      depositRow(deposit("completed", { createdAt: SENT - 1 }), options),
      withdrawalRow(
        withdrawal("proven_waiting", {
          transactionHash: `0x${"01".repeat(32)}`,
        }),
        options
      ),
      depositRow(
        deposit("completed", {
          createdAt: SENT,
          transactionHash: "cd".repeat(32),
        }),
        options
      ),
      withdrawalRow(withdrawal("ready_to_finalize"), options),
    ];

    expect(
      groupBridgeActivity(rows).map(({ head, rows: grouped }) => [
        head,
        grouped.map((row) => row.id),
      ])
    ).toStrictEqual([
      ["Needs you", [`withdrawal:0x${"5a".repeat(32)}`]],
      ["In progress", [`withdrawal:0x${"01".repeat(32)}`]],
      [
        "Completed",
        [`deposit:${"cd".repeat(32)}`, `deposit:${"ab".repeat(32)}`],
      ],
    ]);
    expect(BRIDGE_ACTIVITY_GROUPS.map(([, head]) => head)).toStrictEqual([
      "Needs you",
      "In progress",
      "Sent to someone else",
      "Completed",
      "Didn't go through",
    ]);
  });
});

describe("a withdrawal's proof and claim on Dusk", () => {
  it("are the history's newest of each that didn't fail, by the withdrawal's hash", () => {
    const proved = `0x${"8e".repeat(32)}`;
    /** @param {string} hash @param {"claim" | "prove"} kind @param {string} [status] */
    const row = (hash, kind, status = "executed") =>
      rowOf({
        bridge: { hash: proved.toUpperCase().replace("0X", "0x"), kind },
        hash,
        status,
      });

    expect(
      withdrawalDuskTransactions([
        row("c1".repeat(32), "claim", "failed"),
        row("c2".repeat(32), "claim"),
        row("b2".repeat(32), "prove"),
        row("b1".repeat(32), "prove"),
      ]).get(proved)
    ).toStrictEqual({ claim: "c2".repeat(32), prove: "b2".repeat(32) });
  });
});
