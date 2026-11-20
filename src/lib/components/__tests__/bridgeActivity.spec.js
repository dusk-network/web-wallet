import { afterEach, describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { cardRoutes } from "$lib/bridge/cardRoutes";
import { claimDay } from "$lib/bridge/claimDate";

import {
  BRIDGE_ACTIVITY_GROUPS,
  approvalRow,
  depositRow,
  groupBridgeActivity,
  routeTransferRow,
  withdrawalDuskTransactions,
  withdrawalRow,
} from "../EvmTransactions/bridgeActivity";

const SENT = Date.UTC(2026, 9, 26, 4, 49);
const CLAIM_AT = Date.UTC(2026, 10, 2, 3, 20, 39);
const options = { locale: "en" };

/** A state said, whatever its words. */
const SAID = expect.stringMatching(/\S/);

/** A time of day, as every date the wallet writes has one. */
const A_DATE = /\d:\d\d/;

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
        options,
      ),
    ).toMatchObject({
      group: "done",
      line: expect.stringContaining(claimDay(CLAIM_AT, "en")),
      when: CLAIM_AT,
    });
  });
});

describe("routeTransferRow, on a transfer out", () => {
  const route = /** @type {import("$lib/bridge/cardRoutes").CardRoute} */ (
    cardRoutes(networks.mainnet).find(({ id }) => id === "dusk-to-bsc")
  );
  const NOW = Date.UTC(2026, 10, 5, 12);
  /**
   * @param {Partial<import("$lib/bridge/migrationActivity").RouteTransfer>} fields
   * @returns {import("$lib/bridge/migrationActivity").RouteTransfer}
   */
  const transfer = (fields) => ({
    amountLux: 5_000_000_000n,
    at: NOW - 60_000,
    feeLux: 1_000_000_000n,
    hash: "aa".repeat(32),
    kind: "service",
    recipient: "0x2222222222222222222222222222222222222222",
    route,
    stage: "sent",
    ...fields,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows what arrived once it has, and what was sent until then", () => {
    expect(routeTransferRow(transfer({ stage: "sent" }), options).amount).toBe(
      "5 DUSK",
    );
    expect(
      routeTransferRow(
        transfer({
          arrivedAt: NOW,
          payout: `0x${"bb".repeat(32)}`,
          stage: "arrived",
        }),
        options,
      ).amount,
    ).toBe("4 DUSK");
  });

  it("says it's taking longer than usual once it's taken twice its usual time, not how long it takes", () => {
    vi.useFakeTimers({ now: NOW });

    const time = /** @type {const} */ ({ seconds: 3600, source: "network" });
    const at = (/** @type {number} */ ms) => NOW - ms;
    const onTime = routeTransferRow(transfer({ at: at(3_600_000) }), {
      ...options,
      time,
    }).line;
    const late = routeTransferRow(transfer({ at: at(7_300_000) }), {
      ...options,
      time,
    }).line;

    expect(onTime).toContain(claimDay(at(3_600_000), "en"));
    expect(onTime).toContain("1 hour");
    // Late: not how long it takes, and more than when it was sent.
    expect(late).toContain(claimDay(at(7_300_000), "en"));
    expect(late).not.toContain("1 hour");
    expect(late).not.toBe(
      routeTransferRow(transfer({ at: at(7_300_000) }), options).line,
    );
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
        state: "",
        to: "duskDs",
        when: SENT,
      }),
    );
    expect(withdrawalRow(withdrawal("ready_to_prove"), options)).toEqual(
      expect.objectContaining({
        action: "prove",
        group: "needs",
      }),
    );
  });

  it("should give a waiting withdrawal its claim date, as the chain says it", () => {
    const waiting = withdrawal("proven_waiting", {
      readyAt: String(CLAIM_AT / 1_000),
      readyAtExact: false,
    });
    const day = claimDay(CLAIM_AT, "en");
    const about = withdrawalRow(waiting, options);
    const exact = withdrawalRow({ ...waiting, readyAtExact: true }, options);
    const rejected = withdrawalRow(
      { ...waiting, proofRejected: true },
      options,
    );

    expect(about).toEqual(
      expect.objectContaining({
        action: null,
        group: "progress",
        line: expect.stringContaining(day),
        state: SAID,
      }),
    );
    // Exact, it's said otherwise.
    expect(exact.line).toContain(day);
    expect(exact.line).not.toBe(about.line);
    // A rejected proof's date is no claim date.
    expect(rejected.line).toMatch(/\S/);
    expect(rejected.line).not.toContain(day);
    // No date made up before the chain gives one.
    expect(
      withdrawalRow(withdrawal("proven_waiting"), options).line,
    ).not.toMatch(A_DATE);
  });

  it("should say what a withdrawal waits for before its proof, and after a step was sent", () => {
    expect(withdrawalRow(withdrawal("submitted"), options).line).toContain(
      claimDay(SENT, "en"),
    );
    expect(
      withdrawalRow(
        withdrawal("submitted", { sentAt: null, timestamp: null }),
        options,
      ).line,
    ).not.toMatch(A_DATE);
    expect(
      withdrawalRow(withdrawal("waiting_for_output"), options).line,
    ).not.toMatch(A_DATE);
    expect(
      withdrawalRow(withdrawal("waiting_for_output"), {
        ...options,
        time: { prove: 3_600, seconds: 0, source: "chain" },
      }).line,
    ).toContain(claimDay(SENT + 3_600_000, "en"));
    // A proof or a claim sent waits for Dusk: nothing to send again.
    for (const stage of ["prove_submitted", "finalize_submitted"]) {
      expect(withdrawalRow(withdrawal(stage), options)).toEqual(
        expect.objectContaining({ action: null, group: "progress" }),
      );
    }
  });

  it("should put a claimed withdrawal under done, and a failed one under what didn't go through", () => {
    expect(withdrawalRow(withdrawal("finalized"), options)).toEqual(
      expect.objectContaining({
        group: "done",
        state: "",
      }),
    );
    // Saying where the DUSK still is.
    expect(withdrawalRow(withdrawal("failed"), options)).toEqual(
      expect.objectContaining({
        group: "failed",
        line: expect.stringContaining("DuskEVM"),
        state: SAID,
      }),
    );
  });

  it("should put a withdrawal that pays someone else in a group of its own, saying whom, with its step offered quietly", () => {
    const theirs = withdrawalRow(
      withdrawal("ready_to_prove", { recipient: OTHER }),
      {
        ...options,
        account: OWN,
      },
    );

    expect(theirs).toEqual(
      expect.objectContaining({
        action: "prove",
        forOther: true,
        group: "other",
        line: expect.stringContaining("213qXN…V5JJ9Y"),
        state: "",
      }),
    );
    expect(
      withdrawalRow(withdrawal("proven_waiting", { recipient: OTHER }), {
        ...options,
        account: OWN,
      }),
    ).toEqual(expect.objectContaining({ group: "other", state: SAID }));

    // Done or failed, it goes where all of those go, still saying whom.
    expect(
      withdrawalRow(withdrawal("finalized", { recipient: OTHER }), {
        ...options,
        account: OWN,
      }),
    ).toEqual(
      expect.objectContaining({
        group: "done",
        line: expect.stringContaining("213qXN…V5JJ9Y"),
      }),
    );

    // A contract it pays is said to be one.
    const contract = withdrawalRow(
      withdrawal("ready_to_prove", { recipient: "21a5cb".padEnd(64, "0") }),
      { ...options, account: OWN },
    ).line;

    expect(contract).toContain("21a5cb…000000");
    expect(contract).toMatch(/contract/i);

    // One that pays the account, or whose recipient isn't known: as ever.
    for (const recipient of [OWN, null]) {
      expect(
        withdrawalRow(withdrawal("ready_to_prove", { recipient }), {
          ...options,
          account: OWN,
        }),
      ).toEqual(
        expect.objectContaining({
          forOther: false,
          group: "needs",
        }),
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
        { ...options, account: OWN, steps },
      );

    // Its reads, which are this account's, say it proved it: the claim is
    // this account's to make.
    expect(row("ready_to_finalize")).toEqual(
      expect.objectContaining({
        action: "claim",
        forOther: false,
        group: "needs",
        line: expect.stringContaining("213qXN…V5JJ9Y"),
      }),
    );
    expect(row("proven_waiting")).toEqual(
      expect.objectContaining({
        forOther: false,
        group: "progress",
        state: SAID,
      }),
    );

    // Or they found this account's proof, refused and to be proved again,
    // whether or not the history loaded has it.
    expect(
      row("ready_to_prove", { proofGame: `0x${"1e".repeat(20)}` }),
    ).toEqual(
      expect.objectContaining({
        action: "prove",
        forOther: false,
        group: "needs",
        line: expect.stringContaining("213qXN…V5JJ9Y"),
      }),
    );

    // Or the account's history has its proof, before any read.
    expect(
      row("submitted", {}, new Map([[hash, { prove: "ab".repeat(32) }]])),
    ).toEqual(expect.objectContaining({ forOther: false, group: "progress" }));

    // Not proved here: by nobody yet, or by another account, which leaves
    // this account's reads short of a proof; or at a stage only the explorer
    // gave, which could be anyone's proof.
    expect(row("ready_to_prove", { proofSubmitterCount: 1n })).toEqual(
      expect.objectContaining({ forOther: true, group: "other" }),
    );
    expect(row("proven_waiting", { withdrawalHash: null })).toEqual(
      expect.objectContaining({ forOther: true, group: "other" }),
    );
  });

  it("should leave out an amount it doesn't know", () => {
    expect(
      withdrawalRow(withdrawal("submitted", { amountWei: null }), options)
        .amount,
    ).toBe("");
  });
});

describe("depositRow", () => {
  it("should name a deposit by its route and amount, sent when, and how long it takes", () => {
    const account = "0xab84edffd745af9420ac74fec73121fbee9fc86f";

    expect(depositRow(deposit("l1_pending"), options)).toEqual(
      expect.objectContaining({
        action: null,
        amount: "0.1 DUSK",
        from: "duskDs",
        group: "progress",
        line: expect.stringContaining(claimDay(SENT, "en")),
        state: SAID,
        to: "duskEvm",
      }),
    );

    const usual = depositRow(
      deposit("l2_pending", { l1ConfirmedAt: Date.now() }),
      {
        ...options,
        time: { seconds: 60, source: "chain" },
      },
    ).line;

    expect(usual).toContain(claimDay(SENT, "en"));
    expect(usual).toContain("1 min");
    // Arrived, when DuskEVM's explorer says, and where.
    expect(depositRow(deposit("completed"), options)).toEqual(
      expect.objectContaining({
        group: "done",
        line: expect.stringContaining("DuskEVM"),
        state: "",
      }),
    );

    const arrived = depositRow(
      deposit("completed", { account, arrivedAt: SENT + 60_000 }),
      options,
    ).line;
    const sent = depositRow(deposit("l1_pending", { account }), options).line;

    expect(arrived).toContain(claimDay(SENT + 60_000, "en"));
    expect(arrived).toContain("0xAB84…C86F");
    expect(sent).toContain(claimDay(SENT, "en"));
    expect(sent).toContain("0xAB84…C86F");
  });

  it("should say a deposit takes longer than usual, or why it didn't go through", () => {
    const late = depositRow(
      deposit("l2_pending", { l1ConfirmedAt: SENT }),
      options,
    ).line;

    expect(late).toContain(claimDay(SENT, "en"));
    // More than when it was sent: that it's late.
    expect(late).not.toBe(
      depositRow(deposit("l2_pending", { l1ConfirmedAt: Date.now() }), options)
        .line,
    );

    const onDusk = depositRow(
      deposit("failed", { failureLayer: "l1" }),
      options,
    );
    const onDuskEvm = depositRow(
      deposit("failed", { failureLayer: "l2" }),
      options,
    ).line;

    expect(onDusk).toEqual(
      expect.objectContaining({
        group: "failed",
        state: SAID,
      }),
    );
    // Why, by where: the DUSK never left Dusk, or DuskEVM didn't deliver it.
    expect(onDusk.line).toMatch(/\bDusk\b/);
    expect(onDuskEvm).toContain("DuskEVM");
    expect(onDuskEvm).not.toBe(onDusk.line);
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
        options,
      ),
      depositRow(
        deposit("completed", {
          createdAt: SENT,
          transactionHash: "cd".repeat(32),
        }),
        options,
      ),
      withdrawalRow(withdrawal("ready_to_finalize"), options),
    ];

    expect(
      groupBridgeActivity(rows).map(({ group, rows: grouped }) => [
        group,
        grouped.map((row) => row.id),
      ]),
    ).toStrictEqual([
      ["needs", [`withdrawal:0x${"5a".repeat(32)}`]],
      ["progress", [`withdrawal:0x${"01".repeat(32)}`]],
      ["done", [`deposit:${"cd".repeat(32)}`, `deposit:${"ab".repeat(32)}`]],
    ]);
    expect(BRIDGE_ACTIVITY_GROUPS.map(([group]) => group)).toStrictEqual([
      "needs",
      "progress",
      "other",
      "done",
      "failed",
    ]);
  });
});

describe("a withdrawal's proof and claim on Dusk", () => {
  it("are the history's newest of each that didn't fail, by the withdrawal's hash", () => {
    const proved = `0x${"8e".repeat(32)}`;
    /** @param {string} hash @param {"claim" | "prove"} kind @param {string} [status] @param {Record<string, unknown>} [fields] */
    const row = (hash, kind, status = "executed", fields = {}) =>
      rowOf({
        bridge: { hash: proved.toUpperCase().replace("0X", "0x"), kind },
        hash,
        status,
        ...fields,
      });

    expect(
      withdrawalDuskTransactions([
        row("c1".repeat(32), "claim", "failed"),
        row("c2".repeat(32), "claim"),
        row("b2".repeat(32), "prove"),
        row("b1".repeat(32), "prove"),
      ]).get(proved),
    ).toStrictEqual({ claim: "c2".repeat(32), prove: "b2".repeat(32) });
    // A claim that pays the account shown is the claim all the same.
    expect(
      withdrawalDuskTransactions([
        row("c3".repeat(32), "claim", "executed", {
          amount: "1000000000",
          direction: "in",
        }),
      ]).get(proved),
    ).toStrictEqual({ claim: "c3".repeat(32) });
  });
});

describe("an approval no migration spent", () => {
  const route = /** @type {import("$lib/bridge/cardRoutes").CardRoute} */ (
    cardRoutes(networks.mainnet).find(({ id }) => id === "bsc-to-dusk")
  );
  const OWNER = `0x${"44".repeat(20)}`;
  /** 1 BEP20 DUSK, in the token's wei. */
  const ONE = 1_000_000_000_000_000_000n;

  /**
   * @param {string} hash
   * @param {"open" | "revoke" | "spent" | "uncertain" | "unused"} state
   * @param {bigint} allowance
   * @param {Record<string, unknown>} [fields]
   * @returns {import("@dusk-network/app-core/bridge").MigrationApproval}
   */
  const approval = (hash, state, allowance, fields = {}) => ({
    allowance,
    at: SENT,
    block: 8,
    chain: "BNB Smart Chain",
    coin: "BNB",
    contract: `0x${"cc".repeat(20)}`,
    decimals: 18,
    gasWei: 46_194_000_739_104n,
    hash,
    migration: null,
    owner: OWNER,
    route: "bsc-to-dusk",
    state,
    ...fields,
  });

  /**
   * The titles of a list of approvals, read together, in order.
   *
   * @param {import("@dusk-network/app-core/bridge").MigrationApproval[]} approvals
   */
  const titles = (approvals) =>
    approvals.map(
      (each) => approvalRow(each, { approvals, locale: "en", route })?.title,
    );

  it("should say what it let the migration contract take, and what came of it", () => {
    const [unused, uncertain, open] = titles([
      approval("0x1", "unused", (ONE * 4n) / 1000n),
      approval("0x2", "uncertain", ONE),
      approval("0x3", "open", 2n ** 256n - 1n),
    ]);

    expect(unused).toContain("0.004 BEP20 DUSK");
    expect(uncertain).toMatch(/(?:^|\s)1 BEP20 DUSK/);
    // No limit: any amount, never a figure.
    expect(open).toContain("any amount");
    expect(open).not.toMatch(/\d BEP20/);
  });

  it("should hide what it approved, or what a revoke took back, while balances are hidden: not that it had no limit", () => {
    const approvals = [
      approval("0x1", "unused", (ONE * 4n) / 1000n),
      approval("0x2", "revoke", 0n),
      approval("0x3", "open", 2n ** 256n - 1n),
      approval("0x4", "unused", 1n),
    ];
    const shown = titles(approvals);
    const hidden = approvals.map(
      (each) =>
        approvalRow(each, { approvals, locale: "en", masked: true, route })
          ?.title,
    );

    // The figures go, not the token they're of...
    for (const [index, figure] of /** @type {[number, string][]} */ ([
      [0, "0.004"],
      [1, "0.004"],
      [3, "0.000000001"],
    ])) {
      expect(shown[index]).toContain(figure);
      expect(hidden[index]).not.toContain(figure);
      expect(hidden[index]).toContain("BEP20 DUSK");
    }
    // ...nor that one had no limit.
    expect(hidden[2]).toBe(shown[2]);
  });

  it("should say what a revoke took back of the approval before it: all of it where none of it was drawn, else what was left", () => {
    const [approved, revoked, spent, leftRevoked, others, othersRevoked] =
      titles([
        approval("0x1", "unused", (ONE * 4n) / 1000n),
        approval("0x2", "revoke", 0n),
        // Drawn on by a migration, whose row has its gas: what was left of it.
        approval("0x3", "spent", (ONE * 4n) / 1000n),
        approval("0x4", "revoke", 0n),
        // Another owner's approval before it is no part of it.
        approval("0x5", "unused", ONE, { owner: `0x${"55".repeat(20)}` }),
        approval("0x6", "revoke", 0n, { owner: `0x${"66".repeat(20)}` }),
      ]);

    expect(approved).toContain("0.004 BEP20 DUSK");
    expect(revoked).toContain("0.004 BEP20 DUSK");
    expect(spent).toBeUndefined();
    // What was left of it, said otherwise than all of it.
    expect(leftRevoked).toContain("0.004 BEP20 DUSK");
    expect(leftRevoked).not.toBe(revoked);
    expect(others).toMatch(/(?:^|\s)1 BEP20 DUSK/);
    expect(othersRevoked).not.toMatch(/\d BEP20/);
  });
});
