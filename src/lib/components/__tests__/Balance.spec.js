import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { mdiEyeOffOutline, mdiEyeOutline } from "@mdi/js";
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

  it("renders the Balance component", () => {
    const { container } = render(Balance, baseOptions);

    expect(
      container.querySelector(".dusk-balance__usage-details")
    ).toBeInTheDocument();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should update the Balance component when the props change", async () => {
    const { container, rerender } = render(Balance, baseOptions);

    expect(container.firstElementChild).toMatchSnapshot();

    await rerender({
      fiatCurrency: "EUR",
      fiatPrice: 20,
      locale: "it",
      shieldedAmount: 500_000n,
      tokenCurrency: "DUSK",
      unshieldedAmount: 2_500_000n,
    });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should display the right percentage values", async () => {
    const { container } = render(Balance, baseOptions);

    // Check if public percentage displays as 66.67%
    expect(
      container.querySelector(
        ".dusk-balance__account:first-child .dusk-balance__percentage"
      )?.textContent
    ).toContain("66.67%");

    // Check if shielded percentage displays as 33.33%
    expect(
      container.querySelector(
        ".dusk-balance__account:last-child .dusk-balance__percentage"
      )?.textContent
    ).toContain("33.33%");
  });

  it("should name each balance next to its icon, before its percentage", () => {
    const { container } = render(Balance, baseOptions);
    const percentages = Array.from(
      container.querySelectorAll(".dusk-balance__percentage"),
      (percentage) =>
        Array.from(percentage.children, (child) =>
          child.tagName.toLowerCase() === "svg" ? "icon" : child.textContent
        )
    );

    expect(percentages).toStrictEqual([
      ["icon", "Public", "66.67%"],
      ["icon", "Shielded", "33.33%"],
    ]);
  });

  it("should display the right percentage values when balance is zero", async () => {
    const options = {
      ...baseOptions,
      props: { ...baseProps, shieldedAmount: 0n, unshieldedAmount: 0n },
    };

    const { container } = render(Balance, options);

    expect(
      container.querySelector(
        ".dusk-balance__account:first-child .dusk-balance__percentage"
      )?.textContent
    ).toContain("0%");

    expect(
      container.querySelector(
        ".dusk-balance__account:last-child .dusk-balance__percentage"
      )?.textContent
    ).toContain("0%");
  });

  it("should pass additional class names and attributes to the rendered element", async () => {
    const props = {
      ...baseProps,
      className: "foo bar",
      id: "balance",
    };
    const { container, rerender } = render(Balance, { ...baseOptions, props });

    expect(container.firstElementChild).toHaveClass("foo bar");
    expect(container.firstElementChild).toHaveAttribute("id", "balance");

    await rerender({
      ...props,
      className: "qux",
      id: "new-balance",
    });

    expect(container.firstElementChild).toHaveClass("qux");
    expect(container.firstElementChild).toHaveAttribute("id", "new-balance");
  });

  it("should not display the fiat value if the fiat price is `undefined`", () => {
    const props = { ...baseProps, fiatPrice: undefined };
    const { container } = render(Balance, { ...baseOptions, props });

    expect(container.querySelector(".dusk-balance__fiat--visible")).toBeNull();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should hide and show the balances with the eye button by the heading, named for what it does next", async () => {
    const { container, getByRole } = render(Balance, baseOptions);
    const toggle = getByRole("button", { name: "Hide balances" });
    const getIconPath = () => toggle.querySelector("path")?.getAttribute("d");
    const getTotal = () => container.querySelector(".dusk-balance__dusk");

    expect(toggle).toHaveAttribute("data-tooltip-text", "Hide balances");
    expect(toggle).not.toHaveAttribute("aria-pressed");
    expect(getIconPath()).toBe(mdiEyeOutline);
    expect(getTotal()).toHaveTextContent("0.003000000 DUSK");

    await fireEvent.click(toggle);

    expect(get(settingsStore).hideBalances).toBe(true);
    expect(toggle).toHaveAccessibleName("Show balances");
    expect(toggle).toHaveAttribute("data-tooltip-text", "Show balances");
    expect(getIconPath()).toBe(mdiEyeOffOutline);
    expect(getTotal()).toHaveTextContent("•••• hidden DUSK");

    await fireEvent.click(toggle);

    expect(get(settingsStore).hideBalances).toBe(false);
    expect(toggle).toHaveAccessibleName("Hide balances");
    expect(toggle).toHaveAttribute("data-tooltip-text", "Hide balances");
    expect(getTotal()).toHaveTextContent("0.003000000 DUSK");
  });

  it("should name the DUSK unit of each balance for screen readers", () => {
    const { getAllByRole } = render(Balance, baseOptions);

    expect(getAllByRole("img", { name: "DUSK" })).toHaveLength(2);
  });

  it("should show each value as dots, which screen readers read as hidden, while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getAllByText } = render(Balance, baseOptions);
    const masks = getAllByText("••••");

    // The total, its fiat value, and each balance with its percentage.
    expect(masks).toHaveLength(6);
    expect(masks.map((mask) => mask.getAttribute("aria-hidden"))).toStrictEqual(
      Array(6).fill("true")
    );
    expect(
      getAllByText("hidden").map(({ className }) => className)
    ).toStrictEqual(Array(6).fill("sr-only"));
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.querySelector(".dusk-balance__dusk")).toHaveTextContent(
      /DUSK$/
    );
  });
});
