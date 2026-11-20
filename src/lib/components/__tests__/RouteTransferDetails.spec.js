import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";

import { rowsOf } from "$lib/activity/__tests__/fixtures/rows";
import { cardRoutes } from "$lib/bridge/cardRoutes";
import { settingsStore } from "$lib/stores";

import TransferLedger from "../EvmTransactions/TransferLedger.svelte";
import { ledgerOf } from "../EvmTransactions/bridgeActivity";

const route = /** @type {import("$lib/bridge/cardRoutes").CardRoute} */ (
  cardRoutes(networks.mainnet).find(({ id }) => id === "bsc-to-dusk")
);
const PAID_AT = Date.UTC(2026, 9, 29, 16, 30);

/**
 * A migration from BNB Smart Chain, paid on Dusk.
 *
 * @param {number | null} at When it was sent, where that's known
 * @returns {import("$lib/bridge/migrationActivity").RouteTransfer}
 */
const migration = (at) => ({
  amountLux: 4_000_000_000n,
  at,
  hash: `0x${"bf".repeat(32)}`,
  kind: "migration",
  paidAt: PAID_AT,
  payout: "5c".repeat(32),
  recipient: "",
  route,
  stage: "paid",
});

describe("A transfer's amounts, as its details say them", () => {
  const out = /** @type {import("$lib/bridge/cardRoutes").CardRoute} */ (
    cardRoutes(networks.mainnet).find(({ id }) => id === "dusk-to-bsc")
  );
  const FEE = 1_000_000_000n;
  const HASH = "aa".repeat(32);

  afterEach(() => {
    cleanup();
    settingsStore.update((store) => ({ ...store, hideBalances: false }));
  });

  /** A transfer out, in the history with what it paid. */
  const history = rowsOf([
    {
      amount: "3053082083",
      counterparty: /** @type {any} */ (out).account,
      feePaid: "1859281",
      hash: HASH,
      memo: `0x${"11".repeat(20)}`,
      status: "executed",
    },
  ]);

  /**
   * The ledger of a transfer, as its details are given it.
   *
   * @param {any} activity
   * @param {{ evm?: Record<string, any>, locale?: string, rows?: ActivityRow[], steps?: Map<string, any> }} [context]
   */
  const ledgerFor = (activity, { evm, locale = "en", rows = [], steps } = {}) =>
    ledgerOf(activity, { evm, locale, rows, steps: steps ?? new Map() });

  /**
   * What the details say, each amount by the line it's on: what was sent,
   * the bridge's fee, the network's fee, the gas, and what it received, or
   * is still `expected` to pay, as its label says.
   *
   * @param {any} activity
   * @param {{ evm?: Record<string, any>, locale?: string, rows?: ActivityRow[], steps?: Map<string, any> }} [context]
   * @returns {Record<string, string | undefined>}
   */
  function linesOf(activity, context) {
    const ledger = /** @type {any} */ (ledgerFor(activity, context));
    const { container } = render(TransferLedger, { ledger });
    const rows = Array.from(container.querySelectorAll("dl > div"), (row) => ({
      amount: row.querySelector("dd")?.textContent?.replace(/\s+/g, " ").trim(),
      term: row.querySelector("dt")?.textContent?.trim() ?? "",
    }));
    /** @type {any[]} */
    const lines = ledger?.lines ?? [];

    expect(rows).toHaveLength(lines.length);

    return Object.fromEntries(
      lines.map(({ key }, index) => {
        const { amount, term } = rows[index];

        // What arrived, or what it'll pay, as the line says it.
        const said =
          key !== "received"
            ? key
            : /^you receive$/i.test(term)
              ? "expected"
              : /^received$/i.test(term)
                ? "received"
                : `received, said as "${term}"`;

        return [said, amount];
      }),
    );
  }

  /** @param {Record<string, unknown>} fields */
  const transferOut = (fields) => ({
    item: {
      amountLux: 3_053_082_083n,
      at: PAID_AT,
      feeLux: FEE,
      hash: HASH,
      kind: "service",
      route: out,
      stage: "sent",
      ...fields,
    },
    kind: "service",
  });

  it("gives a transfer out to the last digit, with its fees, and what it'll pay until it has", () => {
    expect(linesOf(transferOut({}), { rows: history })).toStrictEqual({
      bridgeFee: "1 DUSK",
      expected: "2.053082083 BEP20 DUSK",
      networkFee: "0.001859281 DUSK",
      sent: "3.053082083 DUSK",
    });
  });

  it("says what arrived once it has, as the chain said it", () => {
    const arrived = transferOut({
      arrivedLux: 2_053_082_083n,
      payout: "0xcc",
      stage: "arrived",
    });

    expect(linesOf(arrived, { rows: history })).toStrictEqual({
      bridgeFee: "1 DUSK",
      networkFee: "0.001859281 DUSK",
      received: "2.053082083 BEP20 DUSK",
      sent: "3.053082083 DUSK",
    });
  });

  it("says what a transfer that failed on Dusk paid, and nothing about what it moved", () => {
    const failed = rowsOf([
      {
        amount: "3053082083",
        counterparty: /** @type {any} */ (out).account,
        feePaid: "1859281",
        hash: HASH,
        status: "failed",
      },
    ]);

    expect(linesOf(transferOut({}), { rows: failed })).toStrictEqual({
      networkFee: "0.001859281 DUSK",
    });
  });

  /**
   * What a migration did on BNB Smart Chain, as its chain says: the approval it
   * spent found there, or not.
   *
   * @param {Partial<import("@dusk-network/app-core/bridge").MigrationEvm>} [fields]
   * @returns {Record<string, import("@dusk-network/app-core/bridge").MigrationEvm>}
   */
  const onItsChain = (fields) => ({
    [`0x${"bf".repeat(32)}`]: {
      approval: null,
      approvalState: "unread",
      at: PAID_AT - 60_000,
      block: 70_000_000,
      coin: "BNB",
      from: `0x${"12".repeat(20)}`,
      gasWei: 42_205_000_675_280n,
      hash: `0x${"bf".repeat(32)}`,
      lux: 4_000_000_000n,
      route: "bsc-to-dusk",
      state: "mined",
      totalWei: 42_205_000_675_280n,
      ...fields,
    },
  });

  it("writes the gas paid to the wei, as the export does, on screen", () => {
    expect(
      linesOf(
        { item: migration(PAID_AT), kind: "migration" },
        { evm: onItsChain() },
      ).gas,
    ).toBe("0.00004220500067528 BNB");
  });

  it("gives a migration in its token, what was paid out, and the gas paid on its chain with the approval it spent", () => {
    const paid = {
      item: migration(PAID_AT),
      kind: "migration",
    };
    const sent = {
      ...paid,
      item: { ...paid.item, payout: null, stage: "sent" },
    };

    // What this browser kept of it once is the migration's gas alone: what
    // its chain says goes, the approval with it.
    expect(
      linesOf(
        { ...paid, item: { ...paid.item, gasWei: "47005000752080" } },
        {
          evm: onItsChain({
            approval: {
              at: PAID_AT - 120_000,
              block: 69_999_990,
              gasWei: 46_194_000_739_104n,
              hash: `0x${"ab".repeat(32)}`,
            },
            approvalState: "found",
            gasWei: 47_005_000_752_080n,
            totalWei: 93_199_001_491_184n,
          }),
        },
      ),
    ).toStrictEqual({
      gas: "0.000093199001491184 BNB",
      received: "4 DUSK",
      sent: "4 BEP20 DUSK",
    });
    // Not read on its chain yet: no gas said.
    expect(linesOf(paid)).toStrictEqual({
      received: "4 DUSK",
      sent: "4 BEP20 DUSK",
    });
    // Not paid out yet: what it'll pay.
    expect(linesOf(sent)).toStrictEqual({
      expected: "4 DUSK",
      sent: "4 BEP20 DUSK",
    });
  });

  it("says nothing arrives of a transfer the bridge won't pay out, though it went through on Dusk, keeping what was sent and the fee", () => {
    const failed = transferOut({
      failure: "The memo isn't an address: the bridge can't pay it out",
      stage: "failed",
    });
    const lines = linesOf(failed, { rows: history, steps: new Map() });

    // Not what it would have paid: it received nothing.
    expect(lines).toMatchObject({
      networkFee: "0.001859281 DUSK",
      received: "0 BEP20 DUSK",
      sent: "3.053082083 DUSK",
    });
    expect(lines).not.toHaveProperty("expected");
  });

  it("gives a deposit, and a withdrawal with what its proof and claim paid on Dusk", () => {
    expect(
      linesOf({
        item: {
          amountLux: "250000000",
          stage: "completed",
          transactionHash: HASH,
        },
        kind: "deposit",
      }),
    ).toStrictEqual({ received: "0.25 DUSK", sent: "0.25 DUSK" });

    const proof = "b1".repeat(32);
    const claim = "b2".repeat(32);
    const withdrawalHash = `0x${"5c".repeat(32)}`;

    // The network's fees, for the proof and the claim, together.
    expect(
      linesOf(
        {
          item: {
            amountWei: "90082082000000000",
            stage: "finalized",
            withdrawalHash,
          },
          kind: "withdrawal",
        },
        {
          rows: rowsOf(
            [proof, claim].map((hash) => ({
              amount: "0",
              feePaid: "1000000",
              hash,
              status: "executed",
            })),
          ),
          steps: new Map([[withdrawalHash, { claim, prove: proof }]]),
        },
      ),
    ).toStrictEqual({
      networkFee: "0.002 DUSK",
      received: "0.090082082 DUSK",
      sent: "0.090082082 DUSK",
    });
  });

  it("writes them as the language does", () => {
    expect(
      linesOf(transferOut({}), { locale: "de-DE", rows: history }).sent,
    ).toBe("3,053082083 DUSK");
  });

  it("hides them while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const lines = Object.values(linesOf(transferOut({}), { rows: history }));

    expect(lines).toHaveLength(4);
    expect(lines.join(" ")).not.toMatch(/\d[.,]\d/);
  });
});
