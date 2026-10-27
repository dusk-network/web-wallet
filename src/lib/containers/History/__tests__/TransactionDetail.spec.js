import { afterEach, describe, expect, it, vi } from "vitest";
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
const show = (shown, extra = {}, props = {}) =>
  render(TransactionDetail, {
    loadNonce: async () => null,
    locale: "en",
    presentation: describeRow(shown, { ...context, ...extra }),
    row: shown,
    ...props,
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
    // Not arrived yet: greyed.
    expect(container.querySelector(".tx-detail__amount")).toHaveClass(
      "tx-detail__amount--muted"
    );
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

  it("should name the contract a call went to, with a way to copy it", () => {
    const store =
      "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";
    const { container, getAllByRole, getByText } = show(
      row({
        amount: "10000000000",
        contractId: store,
        counterparty: store,
        fnName: "register",
      }),
      { network: "testnet" },
      { network: "testnet" }
    );

    expect(container.querySelector("#tx-detail-title")).toBeTruthy();
    expect(getByText("Registered a .dusk name")).toBeInTheDocument();
    expect(getByText("Dusk Domains")).toBeInTheDocument();
    expect(container.textContent).toContain(store.slice(-6));
    expect(getAllByRole("button", { name: "Copy" })).toHaveLength(2);
  });

  it("should say which account sent it, and its gas price, nonce and block", async () => {
    const account = "2".repeat(60);
    const loadNonce = vi.fn(async () => "110");
    const { findByText, getByRole, getByText } = show(
      row({
        amount: "1000000000",
        blockHash: "bb".repeat(32),
        contractId: undefined,
        gasLimit: "2500000",
        gasPrice: "1",
        gasSpent: "1856487",
        kind: "transfer",
        to: "3".repeat(60),
      }),
      {},
      {
        account: { address: account, label: "Profile 1 · wallet-both.dusk" },
        loadNonce,
      }
    );

    expect(
      getByText("Profile 1 · wallet-both.dusk, public balance")
    ).toBeInTheDocument();
    expect(getByText("1 LUX")).toBeInTheDocument();
    expect(await findByText("110")).toBeInTheDocument();
    expect(loadNonce).toHaveBeenCalledWith("aa".repeat(32));
    expect(getByRole("link", { name: /^4,687,000/ }).getAttribute("href")).toBe(
      `/explorer/blocks/block?id=${"bb".repeat(32)}`
    );
  });

  it("should show a nonce only for the public, final row shown, never one from before", async () => {
    /** @type {Map<string, PromiseWithResolvers<string | null>>} */
    const lookups = new Map();
    const loadNonce = vi.fn((/** @type {string} */ hash) => {
      /** @type {PromiseWithResolvers<string | null>} */
      const lookup = Promise.withResolvers();

      lookups.set(hash, lookup);

      return lookup.promise;
    });
    const transfer = {
      blockHash: undefined,
      contractId: undefined,
      kind: /** @type {const} */ ("transfer"),
      to: "3".repeat(60),
    };
    const publicRow = row({ ...transfer, hash: "a1".repeat(32) });
    const shieldedRow = row({
      ...transfer,
      hash: "a2".repeat(32),
      privacy: "shielded",
      source: "shielded",
    });
    const pending = row({
      ...transfer,
      hash: "a3".repeat(32),
      source: "local",
    });
    const shown = (/** @type {ActivityRow} */ next) => ({
      presentation: describeRow(next, context),
      row: next,
    });
    const { queryByText, rerender } = show(publicRow, {}, { loadNonce });
    const answer = async (/** @type {string} */ hash, value = "110") => {
      lookups.get(hash)?.resolve(value);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await answer(publicRow.hash);

    expect(queryByText("110")).toBeInTheDocument();

    // A shielded row has none: the one shown before goes.
    await rerender(shown(shieldedRow));

    expect(queryByText("Nonce")).toBeNull();

    // An answer that comes after its row was left is dropped.
    await rerender(shown(publicRow));
    await rerender(shown(pending));
    await answer(publicRow.hash, "111");

    expect(queryByText("Nonce")).toBeNull();
    expect(loadNonce).not.toHaveBeenCalledWith(pending.hash);

    // The same row, once final, is looked up.
    await rerender(shown({ ...pending, source: "archive" }));
    await answer(pending.hash, "112");

    expect(queryByText("112")).toBeInTheDocument();
  });
});
