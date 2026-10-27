import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { claimedWithdrawals, describeRow } from "$lib/activity/present";

import TransactionDetail from "../TransactionDetail.svelte";

const BRIDGE = "ab".repeat(32);
const EVM = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const WITHDRAWAL = "0001".padEnd(64, "0");
const context = { bridgeContracts: new Set([BRIDGE]), locale: "en" };

/**
 * @param {Partial<ActivityRow>} fields
 * @returns {ActivityRow}
 */
const row = (fields) => ({
  amount: "0",
  blockHeight: 4_687_000,
  contractId: BRIDGE,
  direction: "out",
  feePaid: "4419010",
  hash: "aa".repeat(32),
  kind: "contract_call",
  privacy: "public",
  source: "archive",
  status: "executed",
  success: true,
  timestamp: Date.now() - 60_000,
  ...fields,
});

/**
 * @param {ActivityRow} shown
 * @param {Partial<import("$lib/activity/present").PresentContext>} [extra]
 */
const show = (shown, extra = {}) =>
  render(TransactionDetail, {
    locale: "en",
    presentation: describeRow(shown, { ...context, ...extra }),
    row: shown,
  });

describe("TransactionDetail", () => {
  afterEach(cleanup);

  it("should name the DuskEVM address a deposit went to", () => {
    const { container, getByText } = show(
      row({
        amount: "100000000",
        bridge: { amount: "100000000", kind: "deposit", to: EVM },
        fnName: "depositETHToWithValue",
      })
    );

    expect(getByText("DuskEVM address")).toBeTruthy();
    expect(container.textContent).toContain(EVM);
    expect(container.textContent).not.toContain(BRIDGE);
  });

  it("should show a proved withdrawal's amount and its next step until it is claimed", () => {
    const proved = row({
      bridge: {
        amount: "1008000000000",
        kind: "prove",
        withdrawal: WITHDRAWAL,
      },
      fnName: "proveWithdrawalTransaction",
    });
    const { container, getByRole, getByText } = show(proved);

    expect(getByText("Proved · not claimed yet")).toBeTruthy();
    expect(
      container.querySelector(".tx-detail__amount")?.textContent
    ).toContain("1,008");
    expect(getByText(/^Claim it on Dusk from about/)).toBeTruthy();
    expect(
      getByRole("link", { name: "Open withdrawals" }).getAttribute("href")
    ).toContain("/dashboard/bridge/transactions?view=withdrawals");

    cleanup();

    const claim = row({
      bridge: {
        amount: "1008000000000",
        kind: "claim",
        withdrawal: WITHDRAWAL,
      },
      fnName: "finalizeWithdrawalTransaction",
    });
    const done = show(proved, { claimed: claimedWithdrawals([claim]) });

    expect(done.getByText("Proved · claimed")).toBeTruthy();
    expect(done.queryByText("Next step")).toBeNull();
  });
});
