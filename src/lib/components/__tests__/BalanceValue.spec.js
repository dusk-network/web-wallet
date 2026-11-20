import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { settingsStore } from "$lib/stores";

import { BalanceValue } from "..";

describe("BalanceValue", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("shows nothing of the value while balances are hidden, not even on hover", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(BalanceValue, {
      exact: "174.559603271",
      value: "174.5596",
    });

    expect(container.innerHTML).not.toContain("174");
  });
});
