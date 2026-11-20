import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { describeFailure, outcomeUnknown } from "$lib/transactions";

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

  it("follows a deposit whose answer got lost, offers no second one, and keeps it once the chain has it", async () => {
    const hash = "ef".repeat(32);
    const found = Promise.withResolvers();
    const onSeen = vi.fn();

    followTransaction.mockReturnValueOnce(found.promise);

    const { getByRole, queryByRole } = render(DepositResult, {
      onRetry: vi.fn(),
      onSeen,
      operation: Promise.reject(
        outcomeUnknown(new TypeError("Failed to fetch"), hash),
      ),
      what: "0.05 DUSK to DuskEVM",
    });

    await vi.waitFor(() =>
      expect(followTransaction).toHaveBeenCalledWith(hash, expect.anything()),
    );
    expect(getByRole("status")).toHaveTextContent("0.05 DUSK to DuskEVM");
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
    expect(onSeen).not.toHaveBeenCalled();

    found.resolve({ blockHeight: 9n, error: null, fee: 1n, timestamp: 1 });

    await vi.waitFor(() =>
      expect(onSeen).toHaveBeenCalledExactlyOnceWith(hash),
    );
  });

  it("offers to try again only when nothing went out", async () => {
    const onRetry = vi.fn();
    const failed = render(DepositResult, {
      onRetry,
      operation: Promise.reject(new TypeError("Failed to fetch")),
    });

    await fireEvent.click(
      await failed.findByRole("button", { name: "Try again" }),
    );

    expect(onRetry).toHaveBeenCalledOnce();

    cleanup();

    const lost = outcomeUnknown(new TypeError("Failed to fetch"));
    const unknown = render(DepositResult, {
      onRetry,
      operation: Promise.reject(lost),
    });

    // Shown as one that may have gone out.
    expect(
      await unknown.findByText(
        /** @type {string} */ (describeFailure(lost).heading),
      ),
    ).toBeInTheDocument();
    expect(unknown.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
