import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

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
});
