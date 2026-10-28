import { describe, expect, it } from "vitest";

import { claimDay } from "$lib/bridge/claimDate";

import {
  BRIDGE_ACTIVITY_GROUPS,
  depositRow,
  groupBridgeActivity,
  withdrawalRow,
} from "../EvmTransactions/bridgeActivity";

const SENT = Date.UTC(2026, 9, 26, 4, 49);
const CLAIM_AT = Date.UTC(2026, 10, 2, 3, 20, 39);
const options = { locale: "en" };

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
    // Arrived.
    expect(depositRow(deposit("completed"), options)).toEqual(
      expect.objectContaining({ group: "done", state: "" })
    );
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
  it("should list what needs you first, then what's under way, done and failed, each newest first, leaving out empty groups", () => {
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
      "Completed",
      "Didn't go through",
    ]);
  });
});
