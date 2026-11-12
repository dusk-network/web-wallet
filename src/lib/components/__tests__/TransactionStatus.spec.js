import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { activityFor, activityState, stopActivity } from "$lib/activity";
import fixture from "$lib/activity/__tests__/fixtures/activity-testnet.json";
import { fakeArchive } from "$lib/activity/__tests__/fixtures/fakeArchive";
import { timeLabel } from "$lib/activity/present";

import { settingsStore, walletStore } from "$lib/stores";

import { TransactionStatus } from "..";

const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

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

    const { getByRole, getByText } = render(TransactionStatus, baseProps);

    expect(followTransaction).toHaveBeenCalledExactlyOnceWith(
      hash,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // Not sent, nor pending, twice over: sending, until a block has it.
    expect(getByRole("status")).toHaveTextContent(
      "Sending… This usually takes under a minute."
    );
    expect(getByText("8dcf6f…3db55e")).toBeInTheDocument();
    expect(
      getByRole("button", { name: "Copy transaction hash" })
    ).toBeInTheDocument();
    expect(getByText("Network fee (at most)")).toBeInTheDocument();
    expect(getByText("0.0025 DUSK")).toBeInTheDocument();
    expect(
      getByRole("link", { name: "View in Dusk explorer" })
    ).toHaveAttribute("href", `/explorer/transactions/transaction?id=${hash}`);
  });

  it("should say when the transaction was sent once its block is final, with the fee it was charged", async () => {
    const following = followNext();
    const { getByRole, getByText, queryByText } = render(
      TransactionStatus,
      baseProps
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
        `Sent at ${timeLabel(blockTime, "en", { seconds: true })} In block 4,687,200.`
      )
    );
    expect(getByRole("status")).toHaveTextContent(/Sent at \d{1,2}:34:07/);

    expect(getByText("Network fee")).toBeInTheDocument();
    expect(getByText("0.001854795 DUSK")).toBeInTheDocument();
    expect(queryByText("Network fee (at most)")).not.toBeInTheDocument();
    expect(queryByText("Details")).not.toBeInTheDocument();
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

    // The block that took it, attested, its next not there yet.
    followTransaction.mock.lastCall?.[1].onBlock(inBlock);

    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        `Sent at ${timeLabel(blockTime, "en", { seconds: true })} In block 4,820,416.`
      )
    );
    expect(refreshBalance).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();

    // Final a block on: what waits for that is told.
    following.resolve(inBlock);

    await vi.waitFor(() => expect(onFinal).toHaveBeenCalledOnce());
    expect(refreshBalance).toHaveBeenCalledOnce();
    expect(getByRole("status")).toHaveTextContent(
      `Sent at ${timeLabel(blockTime, "en", { seconds: true })} In block 4,820,416.`
    );
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
        expect(getByRole("status")).toHaveTextContent(/^Sent at /)
      );
      await vi.waitFor(() =>
        expect(rowOf()).toMatchObject({
          blockHeight: 4_833_654,
          fee: 1_856_861n,
          status: "executed",
          time: blockTime,
          value: 10_000_000n,
        })
      );

      // Final, it says the same, the archive not there yet.
      following.resolve(inBlock);

      await vi.waitFor(() =>
        expect(followTransaction.mock.results[0]?.value).resolves.toBe(inBlock)
      );
      expect(rowOf()).toMatchObject({ status: "executed" });
    } finally {
      stopActivity();
      vi.unstubAllGlobals();
    }
  });

  it("should stay sent where its block took it but the wallet stopped following it before that block was final", async () => {
    const following = followNext();
    const { getByRole } = render(TransactionStatus, baseProps);

    followTransaction.mock.lastCall?.[1].onBlock({
      blockHeight: 4_820_416n,
      error: null,
      fee: 1_854_795n,
      timestamp: 1,
    });
    following.resolve(null);

    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(/^Sent at /)
    );
    expect(getByRole("status")).not.toHaveTextContent("Still pending");
  });

  it("should offer to say when a transfer arrives while it's being sent, and tell whoever isn't looking once a block takes it", async () => {
    const { arrivalTitle, forgetArrivalTitle } =
      await import("$lib/bridge/arrivalNotice");
    const { get } = await import("svelte/store");

    followNext();

    const { container } = render(TransactionStatus, {
      ...baseProps,
      tellArrival: true,
      what: "0.02 DUSK to Lucas",
    });

    expect(container.querySelector(".arrival-notice")).toHaveTextContent(
      "when it arrives"
    );

    // Away from the page as a block takes it: its title says so.
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);

    followTransaction.mock.lastCall?.[1].onBlock({
      blockHeight: 4_820_416n,
      error: null,
      fee: 1_854_795n,
      timestamp: 1,
    });

    await vi.waitFor(() =>
      expect(get(arrivalTitle)).toBe("Arrived: 0.02 DUSK to Lucas")
    );
    expect(container.querySelector(".arrival-notice")).toBeNull();
    hasFocus.mockRestore();
    forgetArrivalTitle();
    cleanup();

    // Not offered where it's no transfer to someone, as a stake.
    followNext();

    const stake = render(TransactionStatus, baseProps);

    expect(stake.container.querySelector(".arrival-notice")).toBeNull();
  });

  it("should hide the fee with the balances, before the block and after", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const following = followNext();
      const { container, getByText } = render(TransactionStatus, baseProps);

      expect(getByText("Network fee (at most)")).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/\d DUSK/);

      following.resolve({
        blockHeight: 4_687_200n,
        error: null,
        fee: 1_854_795n,
        timestamp: 1,
      });
      await vi.waitFor(() =>
        expect(getByText("Network fee")).toBeInTheDocument()
      );

      expect(container.textContent).not.toContain("0.0019");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should show a transaction that failed, the fee it was charged and why", async () => {
    const following = followNext();
    const { container, getByRole, getByText } = render(
      TransactionStatus,
      baseProps
    );

    following.resolve({
      blockHeight: 4_687_200n,
      error: "Panic: out of gas",
      fee: 2_500_000n,
    });
    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        "Failed It didn't go through. The network fee was charged."
      )
    );

    expect(getByText("Network fee")).toBeInTheDocument();
    expect(getByText("0.0025 DUSK")).toBeInTheDocument();
    expect(getByText("Details")).toBeInTheDocument();
    expect(
      container.querySelector(".dusk-error-details__error")
    ).toHaveTextContent("Panic: out of gas");
  });

  it("should say a transaction is still pending once it stops following it, and follow it again when asked", async () => {
    const following = followNext();
    const { getByRole, queryByRole } = render(TransactionStatus, baseProps);

    following.resolve(null);
    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        "Sending… Still pending. See its status in the explorer."
      )
    );

    const again = followNext();

    await fireEvent.click(getByRole("button", { name: "Check again" }));

    expect(followTransaction).toHaveBeenCalledTimes(2);
    expect(getByRole("status")).toHaveTextContent(
      "Sending… This usually takes under a minute."
    );
    expect(queryByRole("button", { name: "Check again" })).toBeNull();

    // A block the node gives no time for: when the wallet saw it final.
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 28, 1, 2));
    again.resolve({ blockHeight: 1n, error: null, fee: 1n, timestamp: null });
    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        `Sent at ${timeLabel(Date.UTC(2026, 9, 28, 1, 2), "en", { seconds: true })} In block 1.`
      )
    );
    vi.restoreAllMocks();
  });

  it("should say a transaction is still pending if it can't be followed", async () => {
    followTransaction.mockRejectedValueOnce(new Error("Invalid hash"));

    const { getByRole } = render(TransactionStatus, baseProps);

    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        "Sending… Still pending. See its status in the explorer."
      )
    );
  });

  it("should stop following the transaction once it is gone", () => {
    followNext();

    const { unmount } = render(TransactionStatus, baseProps);
    const { signal } = followTransaction.mock.calls[0][1];

    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it("should follow nothing without a hash", () => {
    const { getByRole, queryByRole } = render(TransactionStatus, {
      ...baseProps,
      hash: undefined,
    });

    expect(followTransaction).not.toHaveBeenCalled();
    expect(getByRole("status")).toHaveTextContent(
      "Sent The wallet updates automatically."
    );
    expect(queryByRole("link")).toBeNull();
  });
});
