import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { createCurrencyFormatter } from "$lib/dusk/currency";
import { SendPasswordDeclinedError, WalletChangedError } from "$lib/errors";
import { walletStore } from "$lib/stores";
import {
  SendCancelledError,
  SendTakenToReviewError,
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

  /** A send waiting that nothing of it has left the wallet yet. */
  const NOTHING_LEFT_YET = /nothing has left/i;

  /**
   * That it may have gone out, as a send handed over without an answer: gone
   * out, or reached the network, never "may have failed" or "may have
   * reached the signing step".
   */
  const MAY_HAVE_GONE_OUT = /may have (gone out|reached (the network|it)\b)/i;

  /** That nothing went out: what a send that may have gone out never says. */
  const NOTHING_WENT_OUT = /nothing (was sent|left|has left)/i;

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
      expect(getByRole("status")).toHaveTextContent(NOTHING_LEFT_YET);
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

      expect(getByRole("status")).toHaveTextContent(NOTHING_LEFT_YET);
      expect(getByRole("status")).not.toHaveTextContent(MAY_HAVE_GONE_OUT);
      expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();

      // Handed over: it may go out, with nothing to call off.
      await act(() => gate.handOver());

      expect(getByRole("status")).toHaveTextContent(MAY_HAVE_GONE_OUT);
      expect(getByRole("status")).not.toHaveTextContent(NOTHING_LEFT_YET);
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

      expect(getByRole("status")).toHaveTextContent(MAY_HAVE_GONE_OUT);
      expect(getByRole("status")).not.toHaveTextContent(NOTHING_LEFT_YET);
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

  /**
   * What a send that failed came to, as each kind is said: not sent, so it can
   * be tried again; not confirmed, as it may have gone out; refused over what
   * another transaction spent, which may have been an earlier try of it; or
   * taken by a block that failed it, its fee charged. Where the screen has
   * no mark of its own for which, its heading and sentence say it, read by
   * their key words only.
   */
  describe("What a send that failed came to", () => {
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

    /**
     * The way to History, where it's checked whether a send went out: by
     * where it leads, whatever it's called.
     *
     * @param {HTMLElement} container
     */
    const historyLink = (container) =>
      container.querySelector(
        'a[href="/some-base-path/dashboard/transactions"]',
      );

    /** Said not sent: nothing left the wallet. */
    const NOT_SENT = /not sent/i;

    /**
     * Said not sent, or failed before it went out: refused, or never made,
     * with nothing sent either way.
     */
    const SAID_FAILED = /not sent|failed/i;

    /**
     * What the failure's heading and sentence say.
     *
     * @param {HTMLElement} container
     */
    const said = (container) => ({
      heading:
        container.querySelector(".dusk-error-alert__summary")?.textContent ??
        "",
      sentence:
        container.querySelector(".dusk-error-alert__description")
          ?.textContent ?? "",
    });

    it.each([
      // Nothing left the wallet, and no fee was charged.
      [
        "the node out of reach",
        new TypeError("Failed to fetch"),
        NOT_SENT,
        /no fee/i,
      ],
      [
        "the node too slow",
        new Error("Timed out while connecting to the network"),
        NOT_SENT,
        /no fee/i,
      ],
      [
        "a send called off",
        new SendCancelledError(),
        NOT_SENT,
        /nothing left/i,
      ],
      [
        "a send taken to its review instead",
        new SendTakenToReviewError(),
        NOT_SENT,
        /nothing left/i,
      ],
      [
        "the password on big sends not given",
        new SendPasswordDeclinedError(),
        NOT_SENT,
        /password/i,
      ],
      // Refused, or never made: why, by its key words.
      [
        "a refusal for the balance",
        refusal(
          "this transaction is invalid Value spent larger than account holds",
        ),
        SAID_FAILED,
        /balance/i,
      ],
      [
        "too little shielded DUSK",
        new Error("Insufficient funds"),
        SAID_FAILED,
        /balance/i,
      ],
      [
        "a refusal for the gas price",
        refusal("gas price lower than minimum 1"),
        SAID_FAILED,
        /gas price/i,
      ],
      [
        "a refusal for the gas limit",
        refusal("gas limit lower than minimum 5000000"),
        SAID_FAILED,
        /gas limit/i,
      ],
      [
        "a refusal for another reason",
        refusal("Maximum count of transactions exceeded 10000"),
        SAID_FAILED,
        /refused/i,
      ],
      [
        "the wallet switched or locked meanwhile",
        new WalletChangedError(),
        SAID_FAILED,
        /changed or locked/i,
      ],
      [
        "an address it can't read",
        named("DriverDeserializeError", "Failed to deserialize the buffer"),
        SAID_FAILED,
        /address/i,
      ],
      [
        "a proof the network refused",
        refusal("this transaction is invalid Invalid proof"),
        SAID_FAILED,
        /sign/i,
      ],
      [
        "a send declined in the EVM wallet",
        named("UserRejectedRequestError", "User rejected the request."),
        SAID_FAILED,
        /declined/i,
      ],
      [
        "any other failure before it went out",
        new Error("Something no one expected"),
        SAID_FAILED,
        /before it was sent/i,
      ],
      // A refusal holds once it was handed over too.
      [
        "a refusal as it was asked to broadcast it",
        outcomeUnknown(
          refusal(
            "this transaction is invalid Value spent larger than account holds",
          ),
        ),
        SAID_FAILED,
        /balance/i,
      ],
      [
        "a refusal for another reason as it was asked to broadcast it",
        outcomeUnknown(refusal("Maximum count of transactions exceeded 10")),
        SAID_FAILED,
        /refused/i,
      ],
    ])(
      "should say nothing went out, and why, and offer Try again: %s",
      async (_, error, state, why) => {
        const { container, getByRole } = await failed(error);
        const { heading, sentence } = said(container);

        expect(heading).toMatch(state);
        expect(sentence).toMatch(why);
        expect(`${heading} ${sentence}`).not.toMatch(/not confirmed/i);
        expect(`${heading} ${sentence}`).not.toMatch(MAY_HAVE_GONE_OUT);
        expect(historyLink(container)).toBeNull();

        await fireEvent.click(getByRole("button", { name: "Try again" }));

        expect(onRetry).toHaveBeenCalledOnce();
      },
    );

    it.each([
      ["the answer lost", outcomeUnknown(new TypeError("Failed to fetch"))],
      ["the node too slow", outcomeUnknown(new Error("Timed out"))],
      ["any other failure", outcomeUnknown(new Error("Something else"))],
      // Words that only come up as a transaction is made prove nothing here.
      ["a wallet's words", outcomeUnknown(new Error("RuntimeError: oops"))],
      ["a sync's words", outcomeUnknown(new Error("Synchronization aborted"))],
    ])(
      "should say it isn't confirmed, as it may have gone out, and never offer Try again: %s",
      async (_, error) => {
        const { container, queryByRole } = await failed(error);
        const { heading, sentence } = said(container);

        expect(heading).toMatch(/not confirmed/i);
        expect(sentence).toMatch(MAY_HAVE_GONE_OUT);
        expect(`${heading} ${sentence}`).not.toMatch(NOTHING_WENT_OUT);
        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(container).not.toHaveTextContent(/try again/i);
        expect(historyLink(container)).toBeInTheDocument();
      },
    );

    it.each([
      [
        "a nonce used",
        refusal("this transaction is invalid Nonce repeat: 26FCH7 12"),
        /came first/i,
      ],
      [
        "a nonce pending",
        refusal("this transaction's spendId exists in the mempool"),
        /came first/i,
      ],
      [
        "this very transaction in the mempool",
        refusal("this transaction exists in the mempool"),
        /came first/i,
      ],
      [
        "this very transaction in the ledger",
        outcomeUnknown(refusal("this transaction exists in the ledger")),
        /came first/i,
      ],
      [
        "notes spent",
        refusal("this transaction is invalid Nullifiers already spent: [0x01]"),
        /spent already/i,
      ],
    ])(
      "should send to History, never saying it wasn't sent nor offering it, for a refusal over what another transaction spent, maybe an earlier try of this one: %s",
      async (_, error, why) => {
        const { container, queryByRole } = await failed(error);
        const { heading, sentence } = said(container);

        expect(heading).toMatch(/failed/i);
        expect(sentence).toMatch(why);
        expect(`${heading} ${sentence}`).not.toMatch(
          /not sent|nothing (was sent|left)/i,
        );
        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(container).not.toHaveTextContent(/try again/i);
        expect(historyLink(container)).toBeInTheDocument();
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
        expect(container).toHaveTextContent(/check your balance/i),
      );
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("should follow a send whose answer got lost by the hash it may have gone out with, saying it isn't confirmed, and never offer Try again", async () => {
      followTransaction.mockReturnValue(new Promise(() => {}));

      const { container, queryByRole } = render(TransactionResult, {
        ...baseProps,
        onRetry,
        operation: Promise.reject(
          outcomeUnknown(new TypeError("Failed to fetch"), hash),
        ),
      });

      await vi.waitFor(() =>
        expect(followTransaction).toHaveBeenCalledWith(hash, expect.anything()),
      );

      const status = container.querySelector(".transaction-status");

      expect(status).toHaveClass("transaction-status--pending");
      expect(
        container.querySelector(".transaction-status__title"),
      ).toHaveTextContent(/not confirmed/i);
      expect(status).toHaveTextContent(MAY_HAVE_GONE_OUT);
      expect(status).not.toHaveTextContent(NOTHING_WENT_OUT);
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
      expect(queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    it("should say a send a block took but failed did, with the fee it was charged, and never offer Try again", async () => {
      followTransaction.mockResolvedValue({
        blockHeight: 4_687_200n,
        error: "Panic: out of gas",
        fee: 1_234_567n,
      });

      const { container, queryByRole } = render(TransactionResult, {
        ...baseProps,
        onRetry,
        operation: Promise.resolve(hash),
      });

      await vi.waitFor(() =>
        expect(container.querySelector(".transaction-status")).toHaveClass(
          "transaction-status--failed",
        ),
      );

      // Said failed, never sent.
      expect(
        container.querySelector(".transaction-status__title")?.textContent,
      ).toBe("Failed");

      // The fee charged, in its own row: not the most it could have cost
      // (0.0025 DUSK), and never "no fee".
      const fee = Array.from(
        container.querySelectorAll(".transaction-status__details dt"),
      ).find((term) => /fee/i.test(term.textContent ?? ""));

      expect(fee?.textContent).not.toMatch(/at most|up to/i);
      expect(fee?.nextElementSibling).toHaveTextContent(/^0\.001234567 DUSK$/);
      expect(container).not.toHaveTextContent(/\bno (network )?fee\b/i);
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });
  });
});
