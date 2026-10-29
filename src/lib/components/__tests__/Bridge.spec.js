import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

import bridgeTimes from "$lib/bridge/bridgeTimes";
import { formatFee } from "$lib/dusk/currency";
import { settingsStore } from "$lib/stores";
import { account } from "$lib/web3/walletConnection";

import { Bridge } from "..";
import { networks } from "@dusk-network/networks";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

const {
  CONNECTED,
  estimateGas,
  getGasPrice,
  modalOpen,
  pendingDepositAmountLux,
} = vi.hoisted(() => ({
  CONNECTED: {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 745,
    isConnected: true,
  },
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

/** What DuskEVM testnet's chains said on 27 Oct 2026. */
const TESTNET_TIMES = {
  chain: {
    deposit: { at: 1, lagSeconds: 35 },
    withdrawal: {
      at: 1,
      finalitySeconds: 302_400,
      maturitySeconds: 604_800,
      outputSeconds: 1_700,
    },
  },
  network: "testnet",
};

vi.mock("$lib/bridge/bridgeTimes", async () => {
  const { writable } = await import("svelte/store");
  const times = writable({});

  return {
    default: { load: vi.fn(), set: times.set, subscribe: times.subscribe },
  };
});

/** The network and what its chains said, as the Bridge reads them. */
const setTimes = (/** @type {any} */ times) =>
  /** @type {any} */ (bridgeTimes).set(times);

vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");

  return {
    account: writable(CONNECTED),
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
  const baseProps = {
    evmDuskBalance: {
      decimals: 18,
      formatted: "3",
      symbol: "DUSK",
      value: 3_000_000_000_000_000_000n,
    },
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

  // A withdrawal's gas and the DuskEVM gas price, as on testnet.
  const withdrawalGas = 138_463n;
  const evmGasPrice = 10_001_000_000n;

  /** @param {HTMLElement} container */
  const getDirection = (container) =>
    ["from", "to"].map((side) =>
      container
        .querySelector(`button[data-side='${side}']`)
        ?.getAttribute("data-value")
    );

  /** @param {HTMLElement} container */
  const withdraw = (container) =>
    fireEvent.click(
      /** @type {HTMLButtonElement} */ (
        container.querySelector("button[aria-label='Swap From and To']")
      )
    );

  beforeEach(() => {
    // A testnet node: Dusk and DuskEVM, both ways.
    setNodeNetwork(networks.testnet);
    estimateGas.mockResolvedValue(withdrawalGas);
    getGasPrice.mockResolvedValue(evmGasPrice);
    setTimes(TESTNET_TIMES);
  });

  afterEach(() => {
    cleanup();
    estimateGas.mockReset();
    getGasPrice.mockReset();
    modalOpen.mockReset();
    pendingDepositAmountLux.mockReset();
    settingsStore.reset();
    /** @type {import("svelte/store").Writable<any>} */ (account).set(
      CONNECTED
    );
  });

  it("should label the amount, with what is available and a way to use it all", async () => {
    const { getByLabelText, getByRole, getByText } = render(Bridge, baseProps);
    const amount = getByLabelText("Amount");

    expect(amount).toHaveAccessibleDescription("Public balance: 1,000 DUSK");
    expect(getByText("Public balance:")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Max" }));

    // The public balance, past the deposit's fee.
    expect(amount).toHaveValue("999.98");
  });

  it("should leave room for a withdrawal's fee when using it all", async () => {
    const { container, getByLabelText, getByRole } = render(Bridge, baseProps);

    await withdraw(container);

    expect(getByLabelText("Amount")).toHaveAccessibleDescription(
      "DuskEVM balance: 3 DUSK"
    );

    await fireEvent.click(getByRole("button", { name: "Max" }));
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
      await fireEvent.click(getByRole("button", { name: "Max" }));
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
      fireEvent.click(getByRole("button", { name: "Swap From and To" }))
    );

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);
    expect(amount).toHaveValue("1.5");
  });

  it("should swap the direction with a button between From and To", async () => {
    const { container, getByRole, getByText } = render(Bridge, baseProps);
    const swap = getByRole("button", { name: "Swap From and To" });

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);

    await fireEvent.click(swap);

    expect(getDirection(container)).toStrictEqual(["duskEvm", "duskDs"]);
    expect(getByText("DuskEVM balance:")).toBeInTheDocument();

    await fireEvent.click(swap);

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);
  });

  it("should show the connected DuskEVM account, which opens the wallet's account view", async () => {
    const { getByRole } = render(Bridge, baseProps);
    const change = getByRole("button", {
      name: "DuskEVM account 0x2222222222222222222222222222222222222222: disconnect or change wallet",
    });

    expect(change).toHaveTextContent("Change");
    expect(change.parentElement).toHaveTextContent(
      "to your DuskEVM account 0x2222…2222 · Change"
    );

    await fireEvent.click(change);

    expect(modalOpen).toHaveBeenCalledOnce();
  });

  it("should show a withdrawal's estimated fee and the two steps on Dusk before it is sent", async () => {
    const { container, getByRole, getByText } = render(Bridge, baseProps);

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    await vi.waitFor(() =>
      expect(getReviewAmounts(container)).toStrictEqual([
        ["Amount", "2.5 DUSK"],
        ["Network fee (about)", "0.0014 DUSK"],
      ])
    );
    expect(
      getByText(
        "Claim 7 days after you prove. You can prove about 30 minutes after sending."
      )
    ).toBeInTheDocument();
    expect(
      getByText("Each step on Dusk takes a small fee from your public balance.")
    ).toBeInTheDocument();
  });

  it("should show the amount, the network fee and the total when reviewing a deposit", async () => {
    const { container, getByRole } = render(Bridge, baseProps);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", "2.5 DUSK"],
      ["Network fee (at most)", "0.02 DUSK"],
      ["Total (at most)", "2.52 DUSK"],
    ]);
    expect(container.querySelector("dt .dusk-icon")).toBeNull();
    expect(container.querySelector(".gas-fee")).toBeNull();
    // The contract it calls, as the network's file names it.
    expect(
      Array.from(
        container.querySelectorAll(".bridge-review__ends > div"),
        (row) => row.textContent?.replace(/\s+/g, " ").trim()
      ).at(-1)
    ).toBe("Contract DuskEVM bridge 2257e5…a1b31d");
  });

  it("should take new default gas, as the node's price, until the review", async () => {
    const { container, getByRole, rerender } = render(Bridge, baseProps);
    const { gasLimit } = baseProps.gasSettings;

    await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(getReviewAmounts(container)[1]).toStrictEqual([
      "Network fee (at most)",
      "0.06 DUSK",
    ]);

    // Not while reviewing: the fee reviewed is the fee sent.
    await rerender({ gasSettings: { gasLimit, gasPrice: 5n } });

    expect(getReviewAmounts(container)[1]).toStrictEqual([
      "Network fee (at most)",
      "0.06 DUSK",
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
      `${formatFee((gas * evmGasPrice) / 1_000_000_000n, "en")} DUSK`,
    ];

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });

    // The same amount reviewed twice: the first estimate comes back last.
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    estimates[1].resolve(200_000n);
    await settle();
    estimates[0].resolve(100_000n);
    await settle();

    expect(getReviewAmounts(container)[1]).toStrictEqual(feeOf(200_000n));

    // Another profile while the estimate runs: the fee isn't its.
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
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
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(getReviewAmounts(container)).toStrictEqual([["Amount", "2.5 DUSK"]]);
  });

  it("should hide the DuskDS and DuskEVM balances while balances are hidden, but not the Review amounts", async () => {
    pendingDepositAmountLux.mockReturnValue(1_500_000_000n);
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(Bridge, baseProps);

    expect(
      Array.from(container.querySelectorAll(".swap-foot"), (foot) =>
        foot.textContent?.replace(/\s+/g, " ").trim()
      )
    ).toStrictEqual([
      "Public balance: •••• hidden DUSK Max",
      "You receive + •••• hidden DUSK on its way",
    ]);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(getReviewAmounts(container)).toStrictEqual([
      ["Amount", "2.5 DUSK"],
      ["Network fee (at most)", "0.02 DUSK"],
      ["Total (at most)", "2.52 DUSK"],
    ]);
  });

  it("should show the card before a DuskEVM wallet connects: the balance, the route and a button to connect", async () => {
    /** @type {import("svelte/store").Writable<any>} */ (account).set({
      isConnected: false,
    });

    const { container, getByRole, queryByText } = render(Bridge, {
      ...baseProps,
      evmDuskBalance: undefined,
    });

    // No line saying what the card is, nor where it goes before a wallet says.
    expect(queryByText(/^Moves DUSK/)).toBeNull();
    expect(container.querySelector(".swap-recipient")).toBeNull();
    expect(getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/dashboard$/)
    );
    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);
    expect(container.querySelector(".swap-route summary")).toHaveTextContent(
      "~1 min · fee up to 0.02 DUSK"
    );

    await fireEvent.click(
      getByRole("button", { name: "Connect a DuskEVM wallet" })
    );

    expect(modalOpen).toHaveBeenCalledOnce();

    await withdraw(container);

    expect(container.querySelector(".swap-route summary")).toHaveTextContent(
      "~7 days · three steps"
    );
  });

  it("should say what stops a review on the card's one button", async () => {
    const { getByRole } = render(Bridge, baseProps);
    const amount = getByRole("textbox");

    expect(getByRole("button", { name: "Enter an amount" })).toBeDisabled();

    await fireEvent.input(amount, { target: { value: "5000" } });

    expect(getByRole("button", { name: "Not enough DUSK" })).toBeDisabled();
    expect(getByRole("alert")).toHaveTextContent(
      "Your public balance must cover the amount and the fee."
    );

    await fireEvent.input(amount, { target: { value: "2.5" } });

    expect(getByRole("button", { name: "Review bridge" })).toBeEnabled();
  });

  it("should pick the networks from lists, as the network's routes go", async () => {
    const { container, getByRole } = render(Bridge, baseProps);

    await fireEvent.click(
      getByRole("button", { name: "From: Dusk. Choose the network" })
    );

    // Testnet's Sepolia route isn't running: listed, and not picked.
    expect(getByRole("option", { name: /^Sepolia/ })).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    await fireEvent.click(getByRole("option", { name: /DuskEVM/ }));

    expect(getDirection(container)).toStrictEqual(["duskEvm", "duskDs"]);
    expect(
      getByRole("button", { name: "To: Dusk. Choose the network" })
    ).toBeInTheDocument();
  });

  it("should say each way's time on this network the same in the route row, the To list, the review and once sent", async () => {
    const { container, getByRole, getByText } = render(Bridge, baseProps);
    const summary = () =>
      container.querySelector(".swap-route summary")?.textContent?.trim();
    const notes = async () => {
      await fireEvent.click(
        getByRole("button", { name: /^To: .*Choose the network/ })
      );

      const listed = Array.from(
        container.querySelectorAll("[role=option]"),
        (option) => option.textContent?.replace(/\s+/g, " ").trim()
      );

      await fireEvent.keyDown(
        container.querySelector("[role=listbox]") ?? container,
        {
          key: "Escape",
        }
      );

      return listed;
    };

    expect(summary()).toBe("~1 min · fee up to 0.02 DUSK");
    expect(await notes()).toStrictEqual([
      "Sepolia Not running on testnet right now",
      "Dusk It's where it comes from",
      "EVM DuskEVM ~1 min · fee up to 0.02 DUSK",
    ]);

    await withdraw(container);

    expect(summary()).toBe("~7 days · three steps");
    expect(await notes()).toStrictEqual([
      "Sepolia No route from DuskEVM",
      "Dusk ~7 days · three steps",
      "EVM DuskEVM It's where it comes from",
    ]);

    await fireEvent.input(getByRole("textbox"), { target: { value: "1" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(
      getByText(
        "Claim 7 days after you prove. You can prove about 30 minutes after sending."
      )
    ).toBeInTheDocument();
  });

  it("should take what the chain says over the network's own time, and show none where neither is known", async () => {
    setTimes({
      chain: { deposit: { at: 1, lagSeconds: 290 } },
      network: "testnet",
    });

    const { container, getByRole, getByText } = render(Bridge, baseProps);
    const summary = () =>
      container.querySelector(".swap-route summary")?.textContent?.trim();

    // DuskEVM trailing Dusk by five minutes: the deposit says so.
    expect(summary()).toBe("~5 min · fee up to 0.02 DUSK");

    // Mainnet has no DuskEVM yet: nothing is known, and no time is shown.
    setTimes({ chain: null, network: "mainnet" });
    await tick();

    expect(summary()).toBe("Fee up to 0.02 DUSK");

    await withdraw(container);

    expect(summary()).toBe("Three steps");

    await fireEvent.input(getByRole("textbox"), { target: { value: "1" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(getByText("Prove it on Dusk, then claim it.")).toBeInTheDocument();
  });

  it("should leave the review for the form when the EVM wallet disconnects", async () => {
    const { getByRole, queryByRole } = render(Bridge, baseProps);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(getByRole("button", { name: "Send" })).toBeEnabled();

    /** @type {import("svelte/store").Writable<any>} */ (account).set({
      isConnected: false,
    });
    await tick();

    expect(queryByRole("button", { name: "Send" })).toBeNull();
    expect(
      getByRole("button", { name: "Connect a DuskEVM wallet" })
    ).toBeEnabled();
  });
});
