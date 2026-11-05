import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";

import { rowsOf } from "$lib/activity/__tests__/fixtures/rows";
import { cardRoutes } from "$lib/bridge/cardRoutes";
import { settingsStore } from "$lib/stores";

import RouteTransferDetails from "../EvmTransactions/RouteTransferDetails.svelte";
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

/** @param {HTMLElement} container */
const terms = (container) =>
  Array.from(container.querySelectorAll("dt"), (term) => term.textContent);

describe("RouteTransferDetails", () => {
  afterEach(cleanup);

  it("says when a migration known only by its payout was paid, never as when it was sent", () => {
    const { container } = render(RouteTransferDetails, {
      transfer: migration(null),
    });

    expect(terms(container)).toStrictEqual([
      "BNB Smart Chain transaction",
      "Arrived",
      "Dusk payout",
    ]);
  });

  it("says when one sent from here was sent, and when it was paid", () => {
    const { container } = render(RouteTransferDetails, {
      transfer: migration(PAID_AT - 60_000),
    });

    expect(terms(container)).toStrictEqual([
      "Sent",
      "BNB Smart Chain transaction",
      "Arrived",
      "Dusk payout",
    ]);
  });
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
   * What the details say, line by line.
   *
   * @param {any} activity
   * @param {{ locale?: string, rows?: ActivityRow[], steps?: Map<string, any> }} [context]
   */
  function linesOf(activity, { locale = "en", rows = [], steps } = {}) {
    const ledger = ledgerOf(activity, {
      locale,
      rows,
      steps: steps ?? new Map(),
    });
    const { container } = render(TransferLedger, {
      ledger: /** @type {any} */ (ledger),
    });

    return Array.from(container.querySelectorAll("dl > div"), (line) =>
      line.textContent?.replace(/\s+/g, " ").trim()
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

  it("gives a transfer out to the last digit, with its network fee, and what it'll pay until it has", () => {
    expect(linesOf(transferOut({}), { rows: history })).toStrictEqual([
      "Sent 3.053082083 DUSK",
      "Bridge fee 1 DUSK",
      "Network fee 0.001859281 DUSK",
      "You receive 2.053082083 BEP20 DUSK",
    ]);
  });

  it("says what arrived once it has, as the chain said it", () => {
    expect(
      linesOf(
        transferOut({
          arrivedLux: 2_053_082_083n,
          payout: "0xcc",
          stage: "arrived",
        }),
        { rows: history }
      ).at(-1)
    ).toBe("Received 2.053082083 BEP20 DUSK");
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

    expect(linesOf(transferOut({}), { rows: failed })).toStrictEqual([
      "Network fee 0.001859281 DUSK",
    ]);
  });

  it("writes the gas paid short, as other wallets do, with all its decimals on hover", () => {
    const ledger = ledgerOf(
      {
        item: { ...migration(PAID_AT), gasWei: "42205000675280" },
        kind: "migration",
      },
      { locale: "en", rows: [], steps: new Map() }
    );
    const { container } = render(TransferLedger, {
      ledger: /** @type {any} */ (ledger),
    });
    const gas = /** @type {Element} */ (
      Array.from(container.querySelectorAll("dl > div")).find((line) =>
        line.textContent?.includes("Gas")
      )
    );

    expect(gas.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Gas 0.000042 BNB"
    );
    expect(gas.querySelector("[title]")).toHaveAttribute(
      "title",
      "0.00004220500067528"
    );
  });

  it("gives a migration in its token, what was paid out, and the gas paid on its chain", () => {
    const paid = {
      item: migration(PAID_AT),
      kind: "migration",
    };

    expect(
      linesOf({
        ...paid,
        item: { ...paid.item, gasWei: "120000000000000" },
      })
    ).toStrictEqual([
      "Sent 4 BEP20 DUSK",
      "Received 4 DUSK",
      "Gas 0.00012 BNB",
    ]);
    expect(
      linesOf({
        ...paid,
        item: { ...paid.item, payout: null, stage: "sent" },
      })
    ).toStrictEqual(["Sent 4 BEP20 DUSK", "You receive 4 DUSK"]);
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
      })
    ).toStrictEqual(["Sent 0.25 DUSK", "Received 0.25 DUSK"]);

    const proof = "b1".repeat(32);
    const claim = "b2".repeat(32);
    const withdrawalHash = `0x${"5c".repeat(32)}`;

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
            }))
          ),
          steps: new Map([[withdrawalHash, { claim, prove: proof }]]),
        }
      )
    ).toStrictEqual([
      "Sent 0.090082082 DUSK",
      "Network fee 0.002 DUSK",
      "Received 0.090082082 DUSK",
    ]);
  });

  it("writes them as the language does", () => {
    expect(
      linesOf(transferOut({}), { locale: "de-DE", rows: history })[0]
    ).toBe("Sent 3,053082083 DUSK");
  });

  it("hides them while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const lines = linesOf(transferOut({}), { rows: history });

    expect(lines[0]).toBe("Sent •••• hidden DUSK");
    expect(lines.join(" ")).not.toMatch(/\d[.,]\d/);
  });
});
