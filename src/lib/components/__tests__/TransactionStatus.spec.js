import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { timeLabel } from "$lib/activity/present";

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

    const { container, getByRole, getByText } = render(
      TransactionStatus,
      baseProps
    );

    expect(followTransaction).toHaveBeenCalledExactlyOnceWith(hash, {
      signal: expect.any(AbortSignal),
    });
    // Not sent, nor pending, twice over: sending, until a block has it.
    expect(getByRole("status")).toHaveTextContent(
      "Sending… This usually takes under a minute."
    );
    expect(getByText("8dcf6f8a…993db55e")).toBeInTheDocument();
    expect(
      getByRole("button", { name: "Copy transaction hash" })
    ).toBeInTheDocument();
    expect(getByText("Network fee (at most)")).toBeInTheDocument();
    expect(getByText("0.0025 DUSK")).toBeInTheDocument();
    expect(
      getByRole("link", { name: "View in Dusk explorer" })
    ).toHaveAttribute("href", `/explorer/transactions/transaction?id=${hash}`);
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should say when the transaction was sent once its block is final, with the fee it was charged", async () => {
    const following = followNext();
    const { getByRole, getByText, queryByText } = render(
      TransactionStatus,
      baseProps
    );
    const blockTime = Date.UTC(2026, 9, 28, 0, 34);

    following.resolve({
      blockHeight: 4_687_200n,
      error: null,
      fee: 1_854_795n,
      timestamp: blockTime,
    });
    // At its block's time.
    await vi.waitFor(() =>
      expect(getByRole("status")).toHaveTextContent(
        `Sent at ${timeLabel(blockTime, "en")} In block 4,687,200.`
      )
    );

    expect(getByText("Network fee")).toBeInTheDocument();
    expect(getByText("0.0019 DUSK")).toBeInTheDocument();
    expect(queryByText("Network fee (at most)")).not.toBeInTheDocument();
    expect(queryByText("Details")).not.toBeInTheDocument();
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
        `Sent at ${timeLabel(Date.UTC(2026, 9, 28, 1, 2), "en")} In block 1.`
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
