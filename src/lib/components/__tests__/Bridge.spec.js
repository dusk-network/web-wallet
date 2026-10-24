import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import {
  createCurrencyFormatter,
  duskToLux,
  luxToDusk,
} from "$lib/dusk/currency";

import { Bridge } from "..";

vi.mock("$lib/web3/walletConnection", async () => {
  const { readable } = await import("svelte/store");

  return {
    account: readable({
      address: "0x2222222222222222222222222222222222222222",
      chainId: 745,
      isConnected: true,
    }),
    duskEvm: {
      blockExplorers: { default: { url: "https://explorer.example.test" } },
      id: 745,
      nativeCurrency: { decimals: 18 },
    },
    modal: { open: vi.fn() },
    wagmiConfig: {},
  };
});

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

describe("Bridge", () => {
  const formatter = createCurrencyFormatter("en", "DUSK", 9);
  const baseProps = {
    evmDuskBalance: {
      decimals: 18,
      formatted: "3",
      symbol: "DUSK",
      value: 3_000_000_000_000_000_000n,
    },
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
    unshieldedAccount: {},
    unshieldedAddress:
      "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff",
    unshieldedBalance: 1_000_000_000_000n,
  };
  const fee = baseProps.gasSettings.gasLimit * baseProps.gasSettings.gasPrice;

  afterEach(cleanup);

  it("should show the amount, the network fee and the total when reviewing a deposit", async () => {
    const { container, getByRole } = render(Bridge, baseProps);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", formatter(2.5)],
      ["Network fee (max)", formatter(luxToDusk(fee))],
      ["Total (max)", formatter(luxToDusk(duskToLux(2.5) + fee))],
    ]);
    expect(container.querySelector("dt .dusk-icon")).toBeNull();
    expect(container.querySelector(".gas-fee")).toBeNull();
  });

  it("should show only the amount when reviewing a withdrawal, whose fee the EVM wallet sets", async () => {
    const { container, getByRole } = render(Bridge, baseProps);
    const origin = /** @type {HTMLSelectElement} */ (
      container.querySelector("select[name='origin-network']")
    );

    await fireEvent.change(origin, { target: { value: "duskEvm" } });
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", formatter(2.5)],
    ]);
  });
});
