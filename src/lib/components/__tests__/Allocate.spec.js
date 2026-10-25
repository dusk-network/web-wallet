import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import {
  createCurrencyFormatter,
  duskToLux,
  luxToDusk,
} from "$lib/dusk/currency";

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
  const formatter = createCurrencyFormatter("en", "DUSK", 9);
  const baseProps = {
    formatter,
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
  const fee = baseProps.gasSettings.gasLimit * baseProps.gasSettings.gasPrice;

  afterEach(cleanup);

  it("should show the amount, the network fee and the total on the review step", async () => {
    const { container, getByRole } = render(Allocate, baseProps);
    const shieldedInput = getByRole("spinbutton", { name: "Shielded amount" });

    await fireEvent.input(shieldedInput, { target: { value: "2500" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", formatter(500)],
      ["Network fee (max)", formatter(luxToDusk(fee))],
      ["Total (max)", formatter(luxToDusk(duskToLux(500) + fee))],
    ]);
    expect(container.querySelector("dt .dusk-icon")).toBeNull();
    expect(container.querySelector(".gas-fee")).toBeNull();
  });
});
