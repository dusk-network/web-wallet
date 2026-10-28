import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { formatFee } from "$lib/dusk/currency";
import { settingsStore } from "$lib/stores";

import { Allocate } from "..";

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
  });

  it("should show the amount, the network fee and the total on the review step", async () => {
    const { container, getByRole } = render(Allocate, baseProps);
    const shieldedInput = getByRole("spinbutton", { name: "Shielded amount" });

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
    await fireEvent.input(
      getByRole("spinbutton", { name: "Shielded amount" }),
      { target: { value: "2500" } }
    );
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
    const publicInput = getByRole("spinbutton", { name: "Public amount" });
    const shieldedInput = getByRole("spinbutton", { name: "Shielded amount" });
    const nextButton = getByRole("button", { name: "Next" });

    expect(
      container.querySelector(".operation__label small")
    ).toHaveTextContent("(•••• hidden spendable out of •••• hidden total)");
    expect(publicInput).toHaveValue(null);
    expect(shieldedInput).toHaveValue(null);
    expect(publicInput).toHaveAttribute("placeholder", "••••");
    expect(shieldedInput).toHaveAttribute("placeholder", "••••");
    expect(publicInput).toHaveAccessibleDescription("hidden");
    expect(shieldedInput).toHaveAccessibleDescription("hidden");

    await fireEvent.input(publicInput, { target: { value: "3500" } });

    expect(publicInput).toHaveValue(3500);
    expect(publicInput).not.toHaveAccessibleDescription();
    expect(shieldedInput).toHaveValue(null);
    expect(nextButton).toBeDisabled();
    expect(
      getByText("The amount is more than your balance.")
    ).toBeInTheDocument();

    await fireEvent.input(shieldedInput, { target: { value: "2500" } });

    expect(shieldedInput).toHaveValue(2500);
    expect(publicInput).toHaveValue(null);
    expect(nextButton).toBeEnabled();

    await fireEvent.click(nextButton);

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", "500 DUSK"],
      ["Network fee (at most)", "0.02 DUSK"],
      ["Total (at most)", "500.02 DUSK"],
    ]);
  });
});
