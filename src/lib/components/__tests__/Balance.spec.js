import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { settingsStore } from "$lib/stores";

import { Balance } from "..";

describe("Balance", () => {
  const baseProps = {
    fiatCurrency: "USD",
    fiatPrice: 10,
    locale: "en",
    shieldedAmount: 1_000_000n,
    tokenCurrency: "DUSK",
    unshieldedAmount: 2_000_000n,
  };

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("should hide and show the balances with the eye button by the heading", async () => {
    const { container, getByRole } = render(Balance, baseOptions);
    const toggle = getByRole("button", { name: "Hide balances" });
    const getTotal = () => container.querySelector(".dusk-balance__dusk");

    expect(getTotal()).toHaveTextContent(/^0\.003000000 DUSK$/);

    await fireEvent.click(toggle);

    expect(get(settingsStore).hideBalances).toBe(true);
    expect(container.textContent).not.toMatch(/\d/);

    await fireEvent.click(toggle);

    expect(get(settingsStore).hideBalances).toBe(false);
    expect(getTotal()).toHaveTextContent(/^0\.003000000 DUSK$/);
  });

  it("should show no figure while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(Balance, baseOptions);

    expect(container.textContent).not.toMatch(/\d/);
  });

  it("should show the total of both balances, in DUSK and in money, and follow them", async () => {
    const { container, rerender } = render(Balance, baseOptions);
    /** @param {string} selector */
    const figure = (selector) => container.querySelector(selector);

    // 0.003 DUSK, at 10 USD each.
    expect(figure(".dusk-balance__dusk")).toHaveTextContent(
      /^0\.003000000 DUSK$/,
    );
    expect(figure(".dusk-balance__fiat")).toHaveTextContent(/^\$0\.03$/);

    await rerender({
      ...baseProps,
      fiatPrice: 20,
      shieldedAmount: 1_000_000n,
      unshieldedAmount: 4_000_000n,
    });

    expect(figure(".dusk-balance__dusk")).toHaveTextContent(
      /^0\.005000000 DUSK$/,
    );
    expect(figure(".dusk-balance__fiat")).toHaveTextContent(/^\$0\.10$/);
  });
});
