import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { createCurrencyFormatter } from "$lib/dusk/currency";

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
});
