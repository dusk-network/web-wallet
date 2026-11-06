import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { outcomeUnknown } from "$lib/transactions";

import { DepositResult } from "..";

// What the chain says of a transaction followed, as a test gives it.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

// A deposit's progress, as it's tracked: none read yet.
vi.mock("$lib/bridge/depositActivity", async () => {
  const { readable } = await import("svelte/store");

  return {
    depositActivityStore: readable([]),
    trackDepositTransaction: vi.fn(async () => null),
  };
});

describe("DepositResult", () => {
  afterEach(() => {
    cleanup();
    followTransaction.mockReset();
  });

  it("follows a deposit whose answer got lost, and once the chain has it, keeps it and shows its progress", async () => {
    const hash = "ef".repeat(32);
    const found = Promise.withResolvers();
    const onSeen = vi.fn();

    followTransaction.mockReturnValueOnce(found.promise);

    const { findByText, getByRole, queryByRole } = render(DepositResult, {
      onRetry: vi.fn(),
      onSeen,
      operation: Promise.reject(
        outcomeUnknown(new TypeError("Failed to fetch"), hash)
      ),
      what: "0.05 DUSK to DuskEVM",
    });

    expect(await findByText("Not confirmed")).toBeInTheDocument();
    expect(getByRole("status")).toHaveTextContent(
      "0.05 DUSK to DuskEVM It may have reached the network. Wait for it here before you send it again."
    );
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
    expect(followTransaction).toHaveBeenCalledWith(hash, expect.anything());
    expect(onSeen).not.toHaveBeenCalled();

    found.resolve({ blockHeight: 9n, error: null, fee: 1n, timestamp: 1 });

    expect(
      await findByText("Track in activity", { exact: false })
    ).toBeInTheDocument();
    expect(onSeen).toHaveBeenCalledExactlyOnceWith(hash);
  });

  it("says in plain words why a deposit to DuskEVM failed before it went out, with its own message under Details", async () => {
    const { container, findByText } = render(DepositResult, {
      operation: Promise.reject(new TypeError("Failed to fetch")),
    });

    expect(
      await findByText(
        "Couldn't reach the network. Check your connection and try again."
      )
    ).toBeInTheDocument();
    expect(container).toHaveTextContent("Deposit submission failed");
    expect(container.querySelector("details summary")).toHaveTextContent(
      /^Details$/
    );
    expect(container.querySelector("details")).toHaveTextContent(
      "Failed to fetch"
    );
  });

  it("offers to try again only when nothing went out", async () => {
    const onRetry = vi.fn();
    const failed = render(DepositResult, {
      onRetry,
      operation: Promise.reject(new TypeError("Failed to fetch")),
    });

    await fireEvent.click(
      await failed.findByRole("button", { name: "Try again" })
    );

    expect(onRetry).toHaveBeenCalledOnce();

    cleanup();

    const unknown = render(DepositResult, {
      onRetry,
      operation: Promise.reject(
        outcomeUnknown(new TypeError("Failed to fetch"))
      ),
    });

    expect(await unknown.findByText("Not confirmed")).toBeInTheDocument();
    expect(unknown.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
