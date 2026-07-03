import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { EvmTransactions } from "..";

describe("EvmTransactions", () => {
  afterEach(cleanup);

  it("renders the passive DuskEVM withdrawal finalization guidance", () => {
    const { getByRole, getByText } = render(EvmTransactions, {
      target: document.body,
    });

    expect(
      getByText(
        "Bridge withdrawal finalization is handled through the DuskEVM withdrawal flow."
      )
    ).toBeInTheDocument();
    expect(getByRole("link", { name: /back/i }).getAttribute("href")).toMatch(
      /\/dashboard\/bridge$/
    );
  });
});
