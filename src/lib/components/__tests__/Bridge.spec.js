import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import {
  createCurrencyFormatter,
  duskToLux,
  luxToDusk,
} from "$lib/dusk/currency";
import { settingsStore } from "$lib/stores";

import { Bridge } from "..";

const { estimateGas, getGasPrice, modalOpen, pendingDepositAmountLux } =
  vi.hoisted(() => ({
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    modalOpen: vi.fn(),
    pendingDepositAmountLux: vi.fn(() => 0n),
  }));

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  estimateGas,
  getGasPrice,
}));

vi.mock("$lib/bridge/withdrawalInitiation", () => ({
  prepareNativeDuskWithdrawalCall: () => ({
    data: "0x",
    to: "0x4200000000000000000000000000000000000010",
    value: 1n,
  }),
}));

vi.mock("$lib/bridge/depositActivity", async (importOriginal) => ({
  .../** @type {typeof import("$lib/bridge/depositActivity")} */ (
    await importOriginal()
  ),
  pendingDepositAmountLux,
}));

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
    modal: { open: modalOpen },
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

  // A withdrawal's gas and the DuskEVM gas price, as on testnet.
  const withdrawalGas = 138_463n;
  const evmGasPrice = 10_001_000_000n;

  /** @param {HTMLElement} container */
  const getDirection = (container) =>
    ["origin", "destination"].map(
      (end) =>
        /** @type {HTMLSelectElement} */ (
          container.querySelector(`select[name='${end}-network']`)
        ).value
    );

  /** @param {HTMLElement} container */
  const withdraw = (container) =>
    fireEvent.change(
      /** @type {HTMLSelectElement} */ (
        container.querySelector("select[name='origin-network']")
      ),
      { target: { value: "duskEvm" } }
    );

  beforeEach(() => {
    estimateGas.mockResolvedValue(withdrawalGas);
    getGasPrice.mockResolvedValue(evmGasPrice);
  });

  afterEach(() => {
    cleanup();
    estimateGas.mockReset();
    getGasPrice.mockReset();
    modalOpen.mockReset();
    pendingDepositAmountLux.mockReset();
    settingsStore.reset();
  });

  it("should label the amount, with what is available and a way to use it all", async () => {
    const { getByLabelText, getByRole, getByText } = render(Bridge, baseProps);
    const amount = getByLabelText("Amount");

    expect(amount).toHaveAccessibleDescription(
      "Available on DuskDS: 1,000.000000000 DUSK"
    );
    expect(getByText(/^Available on DuskDS:/)).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "USE MAX" }));

    // The public balance, past the deposit's fee.
    expect(amount).toHaveValue("999.98");
  });

  it("should leave room for a withdrawal's fee when using it all", async () => {
    const { container, getByLabelText, getByRole } = render(Bridge, baseProps);

    await withdraw(container);

    expect(getByLabelText("Amount")).toHaveAccessibleDescription(
      "Available on DuskEVM: 3.000000000 DUSK"
    );

    await fireEvent.click(getByRole("button", { name: "USE MAX" }));
    await vi.waitFor(() =>
      // 3 DUSK, less twice the estimated fee.
      expect(getByLabelText("Amount")).toHaveValue("2.997230463")
    );
  });

  it("should drop a withdrawal's maximum that comes back after the amount, the profile or the direction changed", async () => {
    const { container, getByLabelText, getByRole, rerender } = render(
      Bridge,
      baseProps
    );
    const amount = getByLabelText("Amount");

    /**
     * Asks for the maximum, does something else while its fee is
     * estimated, and gives the estimate after.
     *
     * @param {() => Promise<unknown>} meanwhile
     */
    const askMaxThen = async (meanwhile) => {
      /** @type {PromiseWithResolvers<bigint>} */
      const estimate = Promise.withResolvers();

      estimateGas.mockReturnValueOnce(estimate.promise);
      await fireEvent.click(getByRole("button", { name: /^use max$/i }));
      await meanwhile();
      estimate.resolve(withdrawalGas);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await tick();
    };

    await withdraw(container);
    await askMaxThen(() =>
      fireEvent.input(amount, { target: { value: "1.5" } })
    );

    expect(amount).toHaveValue("1.5");

    await askMaxThen(() => rerender({ unshieldedAccount: {} }));

    expect(amount).toHaveValue("1.5");

    await askMaxThen(() =>
      fireEvent.click(getByRole("button", { name: "Swap the direction" }))
    );

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);
    expect(amount).toHaveValue("1.5");
  });

  it("should swap the direction with a button between From and To", async () => {
    const { container, getByRole, getByText } = render(Bridge, baseProps);
    const swap = getByRole("button", { name: "Swap the direction" });

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);

    await fireEvent.click(swap);

    expect(getDirection(container)).toStrictEqual(["duskEvm", "duskDs"]);
    expect(getByText(/^Available on DuskEVM:/)).toBeInTheDocument();

    await fireEvent.click(swap);

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);
  });

  it("should show the connected DuskEVM account, which opens the wallet's account view", async () => {
    const { getByRole } = render(Bridge, baseProps);
    const account = getByRole("button", {
      name: "DuskEVM account 0x2222222222222222222222222222222222222222: disconnect or change wallet",
    });

    expect(account).toHaveTextContent("0x2222…222222");

    await fireEvent.click(account);

    expect(modalOpen).toHaveBeenCalledOnce();
  });

  it("should show a withdrawal's estimated fee and the two steps on Dusk before it is sent", async () => {
    const { container, getByRole, getByText } = render(Bridge, baseProps);

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitFor(() =>
      expect(getReviewAmounts(container)).toStrictEqual([
        ["Amount", `${formatter(2.5)} DUSK`],
        ["Network fee (about)", "0.001384768 DUSK"],
      ])
    );
    expect(
      getByText("Two steps on Dusk, about 7 days in total.")
    ).toBeInTheDocument();
    expect(
      getByText(
        "This fee is paid from your DuskEVM balance. Each step on Dusk takes a small fee from your public balance."
      )
    ).toBeInTheDocument();
  });

  it("should show the amount, the network fee and the total when reviewing a deposit", async () => {
    const { container, getByRole } = render(Bridge, baseProps);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", `${formatter(2.5)} DUSK`],
      ["Network fee (at most)", `${formatter(luxToDusk(fee))} DUSK`],
      ["Total (at most)", `${formatter(luxToDusk(duskToLux(2.5) + fee))} DUSK`],
    ]);
    expect(container.querySelector("dt .dusk-icon")).toBeNull();
    expect(container.querySelector(".gas-fee")).toBeNull();
  });

  it("should take new default gas, as the node's price, until the review", async () => {
    const { container, getByRole, rerender } = render(Bridge, baseProps);
    const { gasLimit } = baseProps.gasSettings;

    await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)[1]).toStrictEqual([
      "Network fee (at most)",
      `${formatter(luxToDusk(gasLimit * 3n))} DUSK`,
    ]);

    // Not while reviewing: the fee reviewed is the fee sent.
    await rerender({ gasSettings: { gasLimit, gasPrice: 5n } });

    expect(getReviewAmounts(container)[1]).toStrictEqual([
      "Network fee (at most)",
      `${formatter(luxToDusk(gasLimit * 3n))} DUSK`,
    ]);
  });

  it("should show the fee of the withdrawal reviewed last, whichever estimate comes back last", async () => {
    const { container, getByRole, rerender } = render(Bridge, baseProps);

    /** @type {PromiseWithResolvers<bigint>[]} */
    const estimates = [];

    estimateGas.mockImplementation(() => {
      /** @type {PromiseWithResolvers<bigint>} */
      const estimate = Promise.withResolvers();

      estimates.push(estimate);

      return estimate.promise;
    });

    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await tick();
    };
    const feeOf = (/** @type {bigint} */ gas) => [
      "Network fee (about)",
      `${formatter(luxToDusk((gas * evmGasPrice) / 1_000_000_000n))} DUSK`,
    ];

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });

    // The same amount reviewed twice: the first estimate comes back last.
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
    estimates[1].resolve(200_000n);
    await settle();
    estimates[0].resolve(100_000n);
    await settle();

    expect(getReviewAmounts(container)[1]).toStrictEqual(feeOf(200_000n));

    // Another profile while the estimate runs: the fee isn't its.
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await rerender({ unshieldedAccount: {} });
    estimates[2].resolve(300_000n);
    await settle();

    expect(getReviewAmounts(container)[1]).not.toStrictEqual(feeOf(300_000n));
  });

  it("should show only the amount when reviewing a withdrawal whose fee can't be estimated", async () => {
    estimateGas.mockRejectedValue(new Error("RPC unavailable"));
    getGasPrice.mockImplementation(() => {
      throw new Error("Chain not configured");
    });

    const { container, getByRole } = render(Bridge, baseProps);

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", `${formatter(2.5)} DUSK`],
    ]);
  });

  it("should hide the DuskDS and DuskEVM balances while balances are hidden, but not the Review amounts", async () => {
    pendingDepositAmountLux.mockReturnValue(1_500_000_000n);
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(Bridge, baseProps);

    expect(
      Array.from(container.querySelectorAll(".balances__balance"), (balance) =>
        balance.textContent?.replace(/\s+/g, " ").trim()
      )
    ).toStrictEqual([
      "•••• hidden",
      "•••• hidden + •••• hidden incoming",
      "0x2222…222222",
    ]);
    expect(
      container.querySelector(".operation__available")?.textContent
    ).toMatch(/^Available on DuskDS:\s+•••• hidden\s+DUSK$/);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", `${formatter(2.5)} DUSK`],
      ["Network fee (at most)", `${formatter(luxToDusk(fee))} DUSK`],
      ["Total (at most)", `${formatter(luxToDusk(duskToLux(2.5) + fee))} DUSK`],
    ]);
  });
});
