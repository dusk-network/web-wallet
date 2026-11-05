import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { outcomeUnknown } from "$lib/transactions";

import { DepositResult } from "..";

describe("DepositResult", () => {
  afterEach(cleanup);

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
