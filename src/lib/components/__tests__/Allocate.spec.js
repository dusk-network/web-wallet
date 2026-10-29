import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { formatFee } from "$lib/dusk/currency";
import { settingsStore } from "$lib/stores";

import { Allocate } from "..";

/** The language's decimal separator, as the browser gives it. */
const separator = vi.hoisted(() => ({ value: "." }));

vi.mock("$lib/dusk/number", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getDecimalSeparator: () => separator.value,
}));

/**
 * The Review step's amounts, as their labels and values.
 *
 * @param {HTMLElement} container
 */
const getReviewAmounts = (container) =>
  Array.from(container.querySelectorAll(".review-amount"), (row) => [
    row.querySelector("dt")?.textContent,
    row.querySelector("dd")?.textContent?.trim(),
  ]);

describe("Allocate", () => {
  const baseProps = {
    gasLimits: {
      gasLimitLower: 10000000n,
      gasLimitUpper: 2900000000n,
      gasPriceLower: 1n,
    },
    gasSettings: {
      gasLimit: 20000000n,
      gasPrice: 1n,
    },
    shieldedAddress:
      "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM",
    shieldedBalance: {
      spendable: 2_000_000_000_000n,
      value: 2_000_000_000_000n,
    },
    unshieldedAddress:
      "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff",
    unshieldedBalance: 1_000_000_000_000n,
  };

  afterEach(() => {
    cleanup();
    settingsStore.reset();
    separator.value = ".";
  });

  it("should write the amounts with the language's decimal separator, and take a comma or a point", async () => {
    separator.value = ",";

    const { container, getByRole } = render(Allocate, {
      ...baseProps,
      unshieldedBalance: 1_000_500_000_000n,
    });
    const publicInput = getByRole("textbox", { name: "Public amount" });
    const shieldedInput = getByRole("textbox", { name: "Shielded amount" });

    // Not "1000.5" in a field of a language that writes 1000,5.
    expect(publicInput).toHaveValue("1000,5");
    expect(shieldedInput).toHaveValue("2000");

    await fireEvent.input(shieldedInput, { target: { value: "2500,25" } });

    expect(shieldedInput).toHaveValue("2500,25");
    expect(publicInput).toHaveValue("500,25");

    await fireEvent.input(publicInput, { target: { value: "0.5" } });

    expect(publicInput).toHaveValue("0.5");
    expect(shieldedInput).toHaveValue("3000");

    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)[0]).toStrictEqual([
      "Amount",
      "1,000 DUSK",
    ]);
  });

  it("should shorten the public account and the shielded address the one way: six characters at each end", () => {
    const { container } = render(Allocate, baseProps);

    expect(
      Array.from(
        container.querySelectorAll(".operation__address-wrapper"),
        (el) => el.textContent?.trim()
      )
    ).toStrictEqual(["zTsZq8…oHybff", "47jNTg…89vnMM"]);
  });

  it("should show the amount, the network fee and the total on the review step", async () => {
    const { container, getByRole } = render(Allocate, baseProps);
    const shieldedInput = getByRole("textbox", { name: "Shielded amount" });

    await fireEvent.input(shieldedInput, { target: { value: "2500" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", "500 DUSK"],
      ["Network fee (at most)", "0.02 DUSK"],
      ["Total (at most)", "500.02 DUSK"],
    ]);
    expect(container.querySelector("dt .dusk-icon")).toBeNull();
    expect(container.querySelector(".gas-fee")).toBeNull();
  });

  it("should take new default gas, as the node's price, until the review, and again once back", async () => {
    const { container, getByRole, rerender } = render(Allocate, baseProps);
    const { gasLimit } = baseProps.gasSettings;

    /** @param {bigint} price */
    const feeRow = (price) => [
      "Network fee (at most)",
      `${formatFee(gasLimit * price, "en", { max: true })} DUSK`,
    ];

    await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
    await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
      target: { value: "2500" },
    });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)[1]).toStrictEqual(feeRow(3n));

    // Not while reviewing: the fee reviewed is the fee sent.
    await rerender({ gasSettings: { gasLimit, gasPrice: 5n } });

    expect(getReviewAmounts(container)[1]).toStrictEqual(feeRow(3n));

    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)[1]).toStrictEqual(feeRow(5n));
  });

  it("should hide the balances while they're hidden, and show what the user types, checked against them", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole, getByText } = render(Allocate, baseProps);
    const publicInput = getByRole("textbox", { name: "Public amount" });
    const shieldedInput = getByRole("textbox", { name: "Shielded amount" });
    const nextButton = getByRole("button", { name: "Next" });

    expect(
      container.querySelector(".operation__label small")
    ).toHaveTextContent("(•••• hidden spendable out of •••• hidden total)");
    expect(publicInput).toHaveValue("");
    expect(shieldedInput).toHaveValue("");
    expect(publicInput).toHaveAttribute("placeholder", "••••");
    expect(shieldedInput).toHaveAttribute("placeholder", "••••");
    expect(publicInput).toHaveAccessibleDescription("hidden");
    expect(shieldedInput).toHaveAccessibleDescription("hidden");

    await fireEvent.input(publicInput, { target: { value: "3500" } });

    expect(publicInput).toHaveValue("3500");
    expect(publicInput).not.toHaveAccessibleDescription();
    expect(shieldedInput).toHaveValue("");
    expect(nextButton).toBeDisabled();
    expect(
      getByText("The amount is more than your balance.")
    ).toBeInTheDocument();

    await fireEvent.input(shieldedInput, { target: { value: "2500" } });

    expect(shieldedInput).toHaveValue("2500");
    expect(publicInput).toHaveValue("");
    expect(nextButton).toBeEnabled();

    await fireEvent.click(nextButton);

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", "500 DUSK"],
      ["Network fee (at most)", "0.02 DUSK"],
      ["Total (at most)", "500.02 DUSK"],
    ]);
  });
});
