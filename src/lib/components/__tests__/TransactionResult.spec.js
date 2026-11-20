import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { createCurrencyFormatter } from "$lib/dusk/currency";
import { WalletChangedError } from "$lib/errors";
import { walletStore } from "$lib/stores";
import {
  CHECK_BALANCE_FIRST,
  SendCancelledError,
  outcomeUnknown,
  sendGate,
} from "$lib/transactions";
import { setNetworkReach } from "$lib/stores/networkReach";

import { TransactionResult } from "..";

const { followTransaction, refreshHistory } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
  refreshHistory: vi.fn(),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

vi.mock("$lib/activity", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  currentActivity: () => ({ refresh: refreshHistory }),
}));

describe("TransactionResult", () => {
  const hash =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
  const baseProps = {
    formatter: createCurrencyFormatter("en", "DUSK", 9),
    maxFee: 2_500_000n,
  };

  afterEach(() => {
    cleanup();
    followTransaction.mockReset();
  });

  // Chen's: on slow Wi-Fi, with its answer held back, the screen said only
  // "Processing transaction".
  it("should say which send it is while it's processed, its answer slow or not, and with no network", async () => {
    const gate = sendGate();
    const what = () =>
      document.querySelector(".transaction-result__what")?.textContent;

    render(TransactionResult, {
      ...baseProps,
      gate,
      memo: "night shift 1",
      operation: new Promise(() => {}),
      what: "0.01 DUSK to your Profile 2",
    });

    /** Which send it is: what it sends, to whom, and its memo. */
    const isSaid = () => {
      expect(what()).toContain("0.01 DUSK to your Profile 2");
      expect(what()).toContain("night shift 1");
    };

    isSaid();

    // Handed over, its answer held back.
    await act(() => gate.handOver());

    isSaid();

    try {
      await act(() => setNetworkReach("offline"));

      isSaid();
    } finally {
      setNetworkReach("answering");
    }
  });

  it("should say a send waits for the network it couldn't reach, with Cancel, though the network's pill finds it answering", async () => {
    const gate = sendGate();
    const { getByRole } = render(TransactionResult, {
      ...baseProps,
      gate,
      operation: new Promise(() => {}),
    });

    gate
      .untilHandedOver(
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => new Promise(() => {}),
      )
      .catch(() => {});

    try {
      await vi.waitFor(() =>
        expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument(),
      );
      expect(getByRole("status")).toBeInTheDocument();
    } finally {
      gate.cancel();
    }
  });

  // Lena's, the node silent: "Nothing has left your wallet yet" with only
  // Home for half a minute, as the node's check hung. The check sends
  // nothing: Cancel stays until the node is asked to broadcast it.
  it("should offer Cancel while the node checks a send, its answer slow and the network found silent, until it's handed over", async () => {
    const gate = sendGate();
    const { getByRole, queryByRole } = render(TransactionResult, {
      ...baseProps,
      gate,
      operation: new Promise(() => {}),
    });

    try {
      await act(() => setNetworkReach("silent"));
      await act(() => gate.checking());

      expect(getByRole("status")).toBeInTheDocument();
      expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();

      // Handed over: it may go out, with nothing to call off.
      await act(() => gate.handOver());

      expect(queryByRole("button", { name: "Cancel" })).toBeNull();
    } finally {
      gate.cancel();
      setNetworkReach("answering");
    }
  });

  it("should call off a send the node is checking with Cancel: it's never handed over", async () => {
    const gate = sendGate();
    const { getByRole } = render(TransactionResult, {
      ...baseProps,
      gate,
      operation: new Promise(() => {}),
    });

    try {
      await act(() => setNetworkReach("silent"));
      await act(() => gate.checking());
      await fireEvent.click(getByRole("button", { name: "Cancel" }));

      expect(get(gate)).toBe("cancelled");
      expect(() => gate.handOver()).toThrow(SendCancelledError);
    } finally {
      setNetworkReach("answering");
    }
  });

  it("should offer no Cancel once a send was handed over and the network doesn't answer", async () => {
    const gate = sendGate();
    const { getByRole, queryByRole } = render(TransactionResult, {
      ...baseProps,
      gate,
      operation: new Promise(() => {}),
    });

    gate.handOver();

    try {
      await act(() => setNetworkReach("silent"));

      expect(getByRole("status")).toBeInTheDocument();
      expect(queryByRole("button", { name: "Cancel" })).toBeNull();
    } finally {
      setNetworkReach("answering");
    }
  });

  it("should follow the transaction once sent", async () => {
    followTransaction.mockReturnValue(new Promise(() => {}));

    render(TransactionResult, {
      ...baseProps,
      operation: Promise.resolve(hash),
    });

    await vi.waitFor(() =>
      expect(followTransaction).toHaveBeenCalledWith(hash, expect.anything()),
    );
  });

  it("should have History and the balances read again as a transaction is final, to say as it does", async () => {
    const refreshBalance = vi
      .spyOn(walletStore, "refreshBalance")
      .mockResolvedValue();

    /** @type {PromiseWithResolvers<any>} */
    const following = Promise.withResolvers();

    refreshHistory.mockClear();
    followTransaction.mockReturnValue(following.promise);

    render(TransactionResult, {
      ...baseProps,
      operation: Promise.resolve(hash),
    });

    await vi.waitFor(() =>
      expect(followTransaction).toHaveBeenCalledWith(hash, expect.anything()),
    );
    expect(refreshHistory).not.toHaveBeenCalled();
    expect(refreshBalance).not.toHaveBeenCalled();

    following.resolve({
      blockHeight: 12n,
      error: null,
      fee: 1n,
      timestamp: Date.now(),
    });

    await vi.waitFor(() => expect(refreshHistory).toHaveBeenCalledOnce());
    expect(refreshBalance).toHaveBeenCalledOnce();

    refreshBalance.mockRestore();
  });

  /**
   * An error as the node's refusal reaches the wallet: w3sper's CallError,
   * with the body of the node's answer as its message.
   *
   * @param {string} reason
   */
  const refusal = (reason) =>
    Object.assign(new Error(`Tx ${hash} not accepted: ${reason}`), {
      name: "CallError",
    });

  /**
   * An error of the kind given, as w3sper's protocol driver throws them.
   *
   * @param {string} name
   * @param {string} message
   */
  const named = (name, message) => Object.assign(new Error(message), { name });

  describe("Try again", () => {
    const onRetry = vi.fn();

    afterEach(() => {
      onRetry.mockClear();
    });

    /** @param {Error} error */
    const failed = async (error) => {
      const view = render(TransactionResult, {
        ...baseProps,
        onRetry,
        operation: Promise.reject(error),
      });

      // Said, with its own message under Details.
      await vi.waitFor(() =>
        expect(view.container.querySelector("details")).toHaveTextContent(
          error.message,
        ),
      );

      return view;
    };

    it.each([
      ["the node out of reach", new TypeError("Failed to fetch")],
      ["any other failure before it went out", new Error("Something else")],
      ["the wallet changing meanwhile", new WalletChangedError()],
      ["an address it can't read", named("DriverDeserializeError", "Bad")],
      [
        "a refusal for the gas price",
        refusal("gas price lower than minimum 1"),
      ],
      [
        "a refusal as it was asked to broadcast it",
        outcomeUnknown(
          refusal(
            "this transaction is invalid Value spent larger than account holds",
          ),
        ),
      ],
      [
        "a refusal for another reason as it was asked to broadcast it",
        outcomeUnknown(refusal("Maximum count of transactions exceeded 10")),
      ],
    ])("should offer it once nothing went out: %s", async (_, error) => {
      const { getByRole, queryByRole } = await failed(error);

      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(onRetry).toHaveBeenCalledOnce();
      expect(queryByRole("link", { name: "Open History" })).toBeNull();
    });

    it.each([
      ["the answer lost", outcomeUnknown(new TypeError("Failed to fetch"))],
      ["the node too slow", outcomeUnknown(new Error("Timed out"))],
      ["any other failure", outcomeUnknown(new Error("Something else"))],
      // Words that only come up as a transaction is made prove nothing here.
      ["a wallet's words", outcomeUnknown(new Error("RuntimeError: oops"))],
      ["a sync's words", outcomeUnknown(new Error("Synchronization aborted"))],
    ])(
      "should never offer it once it may have gone out: %s",
      async (_, error) => {
        const { container, getByRole, queryByRole } = await failed(error);

        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(container).not.toHaveTextContent(/try again/i);
        expect(getByRole("link", { name: "Open History" })).toHaveAttribute(
          "href",
          "/some-base-path/dashboard/transactions",
        );
      },
    );

    it.each([
      [
        "a nonce used",
        refusal("this transaction is invalid Nonce repeat: 26FCH7 12"),
      ],
      [
        "a nonce pending",
        refusal("this transaction's spendId exists in the mempool"),
      ],
      [
        "this very transaction in the mempool",
        refusal("this transaction exists in the mempool"),
      ],
      [
        "this very transaction in the ledger",
        outcomeUnknown(refusal("this transaction exists in the ledger")),
      ],
      [
        "notes spent",
        refusal("this transaction is invalid Nullifiers already spent: [0x01]"),
      ],
    ])(
      "should send to History, not offer it, for a refusal over what another transaction spent, maybe an earlier try of this one: %s",
      async (_, error) => {
        const { container, getByRole, queryByRole } = await failed(error);

        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(container).not.toHaveTextContent(/try again/i);
        expect(getByRole("link", { name: "Open History" })).toBeInTheDocument();
      },
    );

    it("should say what to check where there's no History, and not offer it", async () => {
      const { container, queryByRole } = render(TransactionResult, {
        ...baseProps,
        hasHistory: false,
        onRetry,
        operation: Promise.reject(refusal("Nonce repeat")),
      });

      await vi.waitFor(() =>
        expect(container).toHaveTextContent(CHECK_BALANCE_FIRST),
      );
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });
  });
});
