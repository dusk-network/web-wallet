import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { activityFor, activityState, stopActivity } from "$lib/activity";
import fixture from "$lib/activity/__tests__/fixtures/activity-testnet.json";
import { fakeArchive } from "$lib/activity/__tests__/fixtures/fakeArchive";
import { SENT_AFTER_DONT_SEND, timeLabel } from "$lib/activity/present";

import { settingsStore, walletStore } from "$lib/stores";

import { TransactionStatus } from "..";

/**
 * Text that names each of `values`, in any order, whatever its words.
 *
 * @param {...string} values
 */
const naming = (...values) =>
  new RegExp(
    values
      .map((value) => `(?=.*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
      .join(""),
  );

/**
 * Where the transaction is said to be: pending, late, completed or failed.
 *
 * @param {HTMLElement} container
 */
const statusOf = (container) => container.querySelector(".transaction-status");

const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
}));

vi.mock("$lib/transactions", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  return {
    ...(await importOriginal()),
    followTransaction,
    // The sends kept on this device, as a test says.
    unsentSends: writable([]),
  };
});

// The wallet's own following of a send handed over, as a test says.
vi.mock("$lib/transactions/handedOverSends", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  return {
    ...(await importOriginal()),
    dontSendHandedOver: vi.fn(async () => true),
    followHandedOver: vi.fn(),
    foundSends: writable([]),
    handedOverStates: writable(new Map()),
  };
});

describe("TransactionStatus", () => {
  const hash =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
  const baseProps = {
    hash,
    maxFee: 2_500_000n,
  };

  /**
   * Makes the next transaction followed end as the returned functions say.
   */
  const followNext = () => {
    /** @type {PromiseWithResolvers<any>} */
    const following = Promise.withResolvers();

    followTransaction.mockReturnValueOnce(following.promise);

    return following;
  };

  afterEach(() => {
    cleanup();
    followTransaction.mockReset();
  });

  it("should say a transaction it follows is being sent, with its hash and the most it can cost", async () => {
    followNext();

    const { container, getByText } = render(TransactionStatus, baseProps);

    expect(followTransaction).toHaveBeenCalledExactlyOnceWith(
      hash,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // Sending, until a block has it.
    expect(statusOf(container)).toHaveClass("transaction-status--pending");
    expect(getByText("8dcf6f…3db55e")).toBeInTheDocument();
    expect(getByText("0.0025 DUSK")).toBeInTheDocument();
  });

  it("should say when the transaction was sent once its block is final, with the fee it was charged", async () => {
    const following = followNext();
    const { container, getByRole, getByText } = render(
      TransactionStatus,
      baseProps,
    );
    const blockTime = Date.UTC(2026, 9, 28, 0, 34, 7);

    following.resolve({
      blockHeight: 4_687_200n,
      error: null,
      fee: 1_854_795n,
      timestamp: blockTime,
    });
    // At its block's time, to the second, as the request it paid says it.
    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        naming(timeLabel(blockTime, "en", { seconds: true }), "4,687,200"),
      ),
    );
    expect(getByRole("status")).toHaveTextContent(/\d{1,2}:34:07/);

    // The fee it was charged, no longer the most it could cost.
    expect(getByText("0.001854795 DUSK")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("0.0025");
  });

  it("should say it was sent as soon as a block took it, not once that block is final, and read History and the balances again then", async () => {
    const following = followNext();
    const refreshBalance = vi
      .spyOn(walletStore, "refreshBalance")
      .mockResolvedValue(undefined);
    const onFinal = vi.fn();
    const { getByRole } = render(TransactionStatus, { ...baseProps, onFinal });
    const blockTime = Date.UTC(2026, 10, 10, 6, 56, 39);
    const inBlock = {
      blockHeight: 4_820_416n,
      error: null,
      fee: 1_854_795n,
      timestamp: blockTime,
    };

    // Sent: when, and in which block.
    const sent = naming(
      timeLabel(blockTime, "en", { seconds: true }),
      "4,820,416",
    );

    // The block that took it, attested, its next not there yet.
    followTransaction.mock.lastCall?.[1].onBlock(inBlock);

    await vi.waitFor(() => expect(getByRole("status")).toHaveTextContent(sent));
    expect(refreshBalance).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();

    // Final a block on: what waits for that is told.
    following.resolve(inBlock);

    await vi.waitFor(() => expect(onFinal).toHaveBeenCalledOnce());
    expect(refreshBalance).toHaveBeenCalledOnce();
    expect(getByRole("status")).toHaveTextContent(sent);
    refreshBalance.mockRestore();
  });

  it("should have History and Home say it's sent as soon as it says so, from the block that took it", async () => {
    const [account, to] = Object.keys(fixture.accounts);
    const following = followNext();

    fakeArchive({ finalized: 4_658_000 });

    const session = activityFor({
      account,
      namesNetwork: "testnet",
      nodeUrl: fixture.nodeUrl,
      profileIndex: 0,
    });
    const rowOf = () =>
      get(activityState).rows.find((row) => row.hash === hash);

    try {
      await session.start();
      await session.recordSent({
        amount: "10000000",
        direction: "out",
        hash,
        kind: "transfer",
        privacy: "public",
        to,
      });

      expect(rowOf()).toMatchObject({ status: "pending" });

      const { getByRole } = render(TransactionStatus, baseProps);
      const blockTime = Date.UTC(2026, 10, 12, 1, 41, 9);
      const inBlock = {
        blockHeight: 4_833_654n,
        error: null,
        fee: 1_856_861n,
        timestamp: blockTime,
      };

      followTransaction.mock.lastCall?.[1].onBlock(inBlock);

      await vi.waitFor(() =>
        expect(getByRole("status")).toHaveTextContent("4,833,654"),
      );
      await vi.waitFor(() =>
        expect(rowOf()).toMatchObject({
          blockHeight: 4_833_654,
          fee: 1_856_861n,
          status: "executed",
          time: blockTime,
          value: 10_000_000n,
        }),
      );

      // Final, it says the same, the archive not there yet.
      following.resolve(inBlock);

      await vi.waitFor(() =>
        expect(followTransaction.mock.results[0]?.value).resolves.toBe(inBlock),
      );
      expect(rowOf()).toMatchObject({ status: "executed" });
    } finally {
      stopActivity();
      vi.unstubAllGlobals();
    }
  });

  it("should stay sent where its block took it but the wallet stopped following it before that block was final", async () => {
    const following = followNext();
    const { container, getByRole } = render(TransactionStatus, baseProps);

    followTransaction.mock.lastCall?.[1].onBlock({
      blockHeight: 4_820_416n,
      error: null,
      fee: 1_854_795n,
      timestamp: 1,
    });
    following.resolve(null);

    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent("4,820,416"),
    );
    // Still sent: never late again.
    expect(statusOf(container)).toHaveClass("transaction-status--completed");
  });

  it("should hide the fee with the balances, before the block and after", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const following = followNext();
      const { container, getByRole } = render(TransactionStatus, baseProps);

      expect(container.textContent).not.toMatch(/\d DUSK/);
      expect(container).not.toHaveTextContent("0.0025");

      following.resolve({
        blockHeight: 4_687_200n,
        error: null,
        fee: 1_854_795n,
        timestamp: 1,
      });
      await vi.waitFor(() =>
        expect(getByRole("status")).toHaveTextContent("4,687,200"),
      );

      expect(container.textContent).not.toContain("0.0019");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should show a transaction that failed, the fee it was charged and why", async () => {
    const following = followNext();
    const { container, getByText } = render(TransactionStatus, baseProps);

    following.resolve({
      blockHeight: 4_687_200n,
      error: "Panic: out of gas",
      fee: 2_500_000n,
    });
    await vi.waitFor(() =>
      expect(statusOf(container)).toHaveClass("transaction-status--failed"),
    );

    expect(getByText("0.0025 DUSK")).toBeInTheDocument();
    expect(
      container.querySelector(".dusk-error-details__error"),
    ).toHaveTextContent("Panic: out of gas");
  });

  it("should say a transaction is still pending once it stops following it, and follow it again when asked", async () => {
    const following = followNext();
    const { container, getByRole, queryByRole } = render(
      TransactionStatus,
      baseProps,
    );

    // Late, never failed: it may still go through.
    following.resolve(null);
    await vi.waitFor(() =>
      expect(statusOf(container)).toHaveClass("transaction-status--late"),
    );

    const again = followNext();

    await fireEvent.click(getByRole("button", { name: "Check again" }));

    expect(followTransaction).toHaveBeenCalledTimes(2);
    expect(statusOf(container)).toHaveClass("transaction-status--pending");
    expect(queryByRole("button", { name: "Check again" })).toBeNull();

    // A block the node gives no time for: when the wallet saw it final.
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 28, 1, 2));
    again.resolve({ blockHeight: 1n, error: null, fee: 1n, timestamp: null });
    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        timeLabel(Date.UTC(2026, 9, 28, 1, 2), "en", { seconds: true }),
      ),
    );
    vi.restoreAllMocks();
  });

  // Issue #1066's third: after Don't send, a block took it past the three
  // minutes this followed it for. The wallet's own following found it, and
  // this said Not sent yet still, as History said it was sent.
  it("should say a send the person chose not to send went out after all, once the wallet finds it in a block after this stopped following it", async () => {
    const following = followNext();
    const transactions = await import("$lib/transactions");
    const handedOver = await import("$lib/transactions/handedOverSends");
    const kept = /** @type {import("svelte/store").Writable<any[]>} */ (
      /** @type {unknown} */ (transactions.unsentSends)
    );
    const found = /** @type {import("svelte/store").Writable<any[]>} */ (
      /** @type {unknown} */ (handedOver.foundSends)
    );
    const send = { handedOver: { hash, nonce: "107" }, id: "kept" };
    const landed = Date.UTC(2026, 10, 17, 19, 41, 4);

    kept.set([send]);
    /** @type {import("svelte/store").Writable<Map<string, string>>} */ (
      /** @type {unknown} */ (handedOver.handedOverStates)
    ).set(new Map([[hash, "not-sent"]]));

    try {
      const { container, getByRole, queryByRole } = render(TransactionStatus, {
        ...baseProps,
        unconfirmed: true,
        what: "0.01 DUSK to your Profile 2",
      });

      await fireEvent.click(getByRole("button", { name: "Don't send" }));
      kept.set([
        { ...send, handedOver: { ...send.handedOver, dismissed: true } },
      ]);
      // Three minutes on, still in no block: this stops following it.
      await act(() => following.resolve(null));

      // Not sent, as chosen: nothing to send again, nor said sent.
      expect(getByRole("status")).toHaveTextContent(
        "0.01 DUSK to your Profile 2",
      );
      expect(queryByRole("button", { name: "Send it now" })).toBeNull();
      expect(statusOf(container)).not.toHaveClass(
        "transaction-status--declined",
      );

      // A block took it: found, and kept no more.
      kept.set([]);
      await act(() =>
        found.set([
          {
            send,
            wentOut: {
              blockHeight: 4_850_170n,
              error: null,
              fee: 1_856_521n,
              timestamp: landed,
            },
          },
        ]),
      );

      expect(getByRole("status")).toHaveTextContent(
        naming(
          SENT_AFTER_DONT_SEND,
          timeLabel(landed, "en", { seconds: true }),
          "0.01 DUSK to your Profile 2",
          "4,850,170",
        ),
      );
      expect(statusOf(container)).toHaveClass("transaction-status--declined");
    } finally {
      kept.set([]);
      found.set([]);
    }
  });

  it("should say a transaction is still pending if it can't be followed", async () => {
    followTransaction.mockRejectedValueOnce(new Error("Invalid hash"));

    const { container, getByRole } = render(TransactionStatus, baseProps);

    // Late, never failed: it may still go through.
    await vi.waitFor(() =>
      expect(statusOf(container)).toHaveClass("transaction-status--late"),
    );
    expect(getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });
});
