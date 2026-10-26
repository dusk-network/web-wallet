import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { settingsStore } from "$lib/stores";

import { BalanceValue } from "..";

describe("BalanceValue", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("shows a shortened value in full on hover, and a value that isn't shortened as it is", () => {
    const shortened = render(BalanceValue, {
      exact: "174.559603271",
      value: "174.5596",
    });

    expect(shortened.getByText("174.5596")).toHaveAttribute(
      "title",
      "174.559603271"
    );

    cleanup();

    const whole = render(BalanceValue, { exact: "25", value: "25" });

    expect(whole.container).toHaveTextContent("25");
    expect(whole.container.querySelector("[title]")).toBeNull();
  });

  it("shows nothing of the value while balances are hidden, not even on hover", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(BalanceValue, {
      exact: "174.559603271",
      value: "174.5596",
    });

    expect(container).toHaveTextContent("•••• hidden");
    expect(container.querySelector("[title]")).toBeNull();
  });
});
