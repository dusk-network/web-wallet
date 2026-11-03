import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { createCurrencyFormatter } from "$lib/dusk/currency";
import { WalletChangedError } from "$lib/errors";

import { TransactionResult } from "..";

const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
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
    [
      "the node out of reach",
      new TypeError("Failed to fetch"),
      "Couldn't reach the network. Check your connection and try again.",
    ],
    [
      "the node too slow",
      new Error("Timed out while connecting to the network"),
      "Couldn't reach the network. Check your connection and try again.",
    ],
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
      "a refusal for a nonce used",
      refusal("this transaction is invalid Nonce repeat: 26FCH7 12"),
      "The network refused it: another transaction from this account came first. Wait a minute and try again.",
    ],
    [
      "a refusal for a nonce pending",
      refusal("this transaction's spendId exists in the mempool"),
      "The network refused it: another transaction from this account came first. Wait a minute and try again.",
    ],
    [
      "a refusal for notes spent",
      refusal("this transaction is invalid Nullifiers already spent: [0x01]"),
      "The network refused it: some of the shielded DUSK it spends is spent already. Wait for the wallet to sync and try again.",
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
      "a signing error",
      named("DriverDeserializeError", "Failed to deserialize the buffer"),
      "The wallet couldn't sign it, so nothing was sent. Reload the page and try again.",
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
