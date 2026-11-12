import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { createCurrencyFormatter } from "$lib/dusk/currency";
import { WalletChangedError } from "$lib/errors";
import { walletStore } from "$lib/stores";
import { outcomeUnknown, sendGate } from "$lib/transactions";

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
  const onBeforeLeave = vi.fn();
  const baseProps = {
    formatter: createCurrencyFormatter("en", "DUSK", 9),
    maxFee: 2_500_000n,
    onBeforeLeave,
  };

  /**
   * Clicks a link without letting jsdom navigate.
   *
   * @param {HTMLElement} link
   */
  const clickLink = async (link) => {
    link.addEventListener("click", (event) => event.preventDefault());
    await fireEvent.click(link);
  };

  afterEach(() => {
    cleanup();
    followTransaction.mockReset();
    onBeforeLeave.mockClear();
  });

  it("should say the transaction is being processed while it is sent", () => {
    const { getByText } = render(TransactionResult, {
      ...baseProps,
      operation: new Promise(() => {}),
    });

    expect(getByText("Processing transaction")).toBeInTheDocument();
    expect(followTransaction).not.toHaveBeenCalled();
  });

  it("should say a send waits for the network it couldn't reach, with Cancel and Home, though the network's pill finds it answering", async () => {
    const gate = sendGate();
    const { getByRole } = render(TransactionResult, {
      ...baseProps,
      gate,
      operation: new Promise(() => {}),
    });

    gate
      .untilHandedOver(
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => new Promise(() => {})
      )
      .catch(() => {});

    try {
      await vi.waitFor(() =>
        expect(getByRole("status")).toHaveTextContent(
          /^Nothing has left your wallet yet\. It goes out once the network answers\.$/
        )
      );
      expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(getByRole("link", { name: "Home" })).toBeInTheDocument();
    } finally {
      gate.cancel();
    }
  });

  it("should follow the transaction once sent, with a way home", async () => {
    followTransaction.mockReturnValue(new Promise(() => {}));

    const { findByRole, getByRole } = render(TransactionResult, {
      ...baseProps,
      operation: Promise.resolve(hash),
    });

    expect(await findByRole("status")).toHaveTextContent(/^Sending… /);
    expect(followTransaction).toHaveBeenCalledWith(hash, expect.anything());

    await clickLink(getByRole("link", { name: "Home" }));

    expect(onBeforeLeave).toHaveBeenCalledTimes(1);
  });

  it("should have History and the balances read again as a transaction is final, to say as it does", async () => {
    const refreshBalance = vi
      .spyOn(walletStore, "refreshBalance")
      .mockResolvedValue();

    /** @type {PromiseWithResolvers<any>} */
    const following = Promise.withResolvers();

    refreshHistory.mockClear();
    followTransaction.mockReturnValue(following.promise);

    const { findByRole } = render(TransactionResult, {
      ...baseProps,
      operation: Promise.resolve(hash),
    });

    expect(await findByRole("status")).toHaveTextContent(/^Sending… /);
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

  it("should show why the transaction couldn't be sent, with a way home", async () => {
    const { findByText, getByRole } = render(TransactionResult, {
      ...baseProps,
      operation: Promise.reject(new Error("Insufficient balance")),
    });

    expect(await findByText("Transaction failed")).toBeInTheDocument();
    expect(followTransaction).not.toHaveBeenCalled();

    await clickLink(getByRole("link", { name: "Home" }));

    expect(onBeforeLeave).toHaveBeenCalledTimes(1);
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

  it.each([
    ["the node out of reach", new TypeError("Failed to fetch")],
    [
      "the node too slow",
      new Error("Timed out while connecting to the network"),
    ],
  ])(
    "should say a send that couldn't reach the network wasn't sent, and cost nothing: %s, with its own message under Details",
    async (_, error) => {
      const { container, findByText, getByText, queryByText } = render(
        TransactionResult,
        { ...baseProps, operation: Promise.reject(error) }
      );

      expect(
        await findByText(
          "Couldn't reach the network. Nothing was sent and no fee was charged."
        )
      ).toBeInTheDocument();
      expect(getByText("Not sent")).toBeInTheDocument();
      expect(queryByText("Transaction failed")).toBeNull();
      expect(container.querySelector("details")).toHaveTextContent(
        error.message
      );
    }
  );

  it.each([
    [
      "a refusal for the balance",
      refusal(
        "this transaction is invalid Value spent larger than account holds"
      ),
      "The network refused it: the balance doesn't cover it and its fee. Lower the amount and try again.",
    ],
    [
      "too little shielded DUSK",
      new Error("Insufficient funds"),
      "The balance doesn't cover it and its fee, so nothing was sent. Lower the amount and try again.",
    ],
    [
      "a refusal for the gas price",
      refusal("gas price lower than minimum 1"),
      "The network refused it: the gas price is under its minimum. Raise it and try again.",
    ],
    [
      "a refusal for the gas limit",
      refusal("gas limit lower than minimum 5000000"),
      "The network refused it: the gas limit is under its minimum. Raise it and try again.",
    ],
    [
      "a refusal for another reason",
      refusal("Maximum count of transactions exceeded 10000"),
      "The network refused it. See Details for why.",
    ],
    [
      "the wallet switched or locked meanwhile",
      new WalletChangedError(),
      "The wallet changed or locked before it went out, so nothing was sent. Try again.",
    ],
    [
      "an address it can't read",
      named("DriverDeserializeError", "Failed to deserialize the buffer"),
      "The wallet couldn't read the address, so nothing was sent. Check it and try again.",
    ],
    [
      "a proof the network refused",
      refusal("this transaction is invalid Invalid proof"),
      "The wallet couldn't sign it, so nothing was sent. Reload the page and try again.",
    ],
  ])(
    "should say in a plain sentence why a send failed before it went out: %s, with its own message under Details",
    async (_, error, sentence) => {
      const { container, findByText, getByText } = render(TransactionResult, {
        ...baseProps,
        operation: Promise.reject(error),
      });

      expect(await findByText(sentence)).toBeInTheDocument();
      expect(getByText("Transaction failed")).toBeInTheDocument();

      const details = /** @type {HTMLDetailsElement} */ (
        container.querySelector("details")
      );

      expect(details.querySelector("summary")).toHaveTextContent(/^Details$/);
      expect(details).toHaveTextContent(error.message);
    }
  );

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

      await view.findByText(/^(Transaction failed|Not sent|Not confirmed)$/);

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
            "this transaction is invalid Value spent larger than account holds"
          )
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
      expect(queryByRole("link", { name: "Home" })).toBeInTheDocument();
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
        const { container, getByRole, getByText, queryByRole } =
          await failed(error);

        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(getByText("Not confirmed")).toBeInTheDocument();
        expect(
          getByText(
            "It may have reached the network. Check History before you send it again."
          )
        ).toBeInTheDocument();
        expect(container).not.toHaveTextContent(/try again/i);
        expect(getByRole("link", { name: "Open History" })).toHaveAttribute(
          "href",
          "/some-base-path/dashboard/transactions"
        );
      }
    );

    it.each([
      [
        "a nonce used",
        refusal("this transaction is invalid Nonce repeat: 26FCH7 12"),
        "The network refused it: another transaction from this account came first.",
      ],
      [
        "a nonce pending",
        refusal("this transaction's spendId exists in the mempool"),
        "The network refused it: another transaction from this account came first.",
      ],
      [
        "this very transaction in the mempool",
        refusal("this transaction exists in the mempool"),
        "The network refused it: another transaction from this account came first.",
      ],
      [
        "this very transaction in the ledger",
        outcomeUnknown(refusal("this transaction exists in the ledger")),
        "The network refused it: another transaction from this account came first.",
      ],
      [
        "notes spent",
        refusal("this transaction is invalid Nullifiers already spent: [0x01]"),
        "The network refused it: some of the shielded DUSK it spends is spent already.",
      ],
    ])(
      "should send to History, not offer it, for a refusal over what another transaction spent, maybe an earlier try of this one: %s",
      async (_, error, said) => {
        const { container, getByRole, getByText, queryByRole } =
          await failed(error);

        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(getByText("Transaction failed")).toBeInTheDocument();
        expect(
          getByText(`${said} Check History before you send it again.`)
        ).toBeInTheDocument();
        expect(container).not.toHaveTextContent(/try again/i);
        expect(getByRole("link", { name: "Open History" })).toBeInTheDocument();
      }
    );

    it("should say what to check where there's no History, and not offer it", async () => {
      const { getByText, queryByRole } = render(TransactionResult, {
        ...baseProps,
        hasHistory: false,
        onRetry,
        operation: Promise.reject(refusal("Nonce repeat")),
      });

      await vi.waitFor(() =>
        expect(
          getByText(
            "The network refused it: another transaction from this account came first. Wait a few minutes and check your balance before you send it again."
          )
        ).toBeInTheDocument()
      );
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("should offer it only where something can go back to the review", async () => {
      const { findByText, queryByRole } = render(TransactionResult, {
        ...baseProps,
        operation: Promise.reject(new TypeError("Failed to fetch")),
      });

      await findByText("Not sent");

      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });
  });

  it("should keep a sentence for any other failure, with its own message under Details", async () => {
    const { container, findByText } = render(TransactionResult, {
      ...baseProps,
      operation: Promise.reject(new Error("Something no one expected")),
    });

    expect(
      await findByText("Something went wrong before it was sent. Try again.")
    ).toBeInTheDocument();

    const details = /** @type {HTMLDetailsElement} */ (
      container.querySelector("details")
    );

    expect(details.querySelector("summary")).toHaveTextContent(/^Details$/);
    expect(details).toHaveTextContent("Something no one expected");
  });
});
