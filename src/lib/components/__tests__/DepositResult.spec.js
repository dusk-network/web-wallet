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

/** What the screen says of what never went out: its status, Not sent. */
const NOTHING_SENT = /\bnot sent\b/i;

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

    const { container, getByRole, queryByRole } = render(DepositResult, {
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

    // Not confirmed, as it may have gone out: never sent, nor not sent.
    const status = getByRole("status");

    expect(
      status.querySelector(".transaction-status__what")?.textContent?.trim(),
    ).toBe("0.05 DUSK to DuskEVM");
    expect(
      status.querySelector(".transaction-status__title")?.textContent,
    ).toMatch(/\bnot confirmed\b/i);
    expect(container).not.toHaveTextContent(NOTHING_SENT);
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
    expect(onSeen).not.toHaveBeenCalled();

    found.resolve({ blockHeight: 9n, error: null, fee: 1n, timestamp: 1 });

    await vi.waitFor(() =>
      expect(onSeen).toHaveBeenCalledExactlyOnceWith(hash),
    );
  });

  it("says a deposit that failed before it went out wasn't sent, and charged no fee", async () => {
    const { container, findByText } = render(DepositResult, {
      operation: Promise.reject(new TypeError("Failed to fetch")),
    });

    // Its status, Not sent, and that no fee went with it.
    expect(await findByText("Not sent")).toBeInTheDocument();
    expect(container).toHaveTextContent(NOTHING_SENT);
    expect(container).toHaveTextContent(/\bno fee\b/i);
    expect(container).not.toHaveTextContent(/\bnot confirmed\b/i);
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

    const unknown = render(DepositResult, {
      onRetry,
      operation: Promise.reject(
        outcomeUnknown(new TypeError("Failed to fetch")),
      ),
    });

    // Not confirmed, as it may have gone out: no Try again.
    expect(await unknown.findByText(/\bnot confirmed\b/i)).toBeInTheDocument();
    expect(unknown.container).not.toHaveTextContent(NOTHING_SENT);
    expect(unknown.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
