import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { ProfileGenerator } from "@dusk/w3sper";

import bridgeTimes from "$lib/bridge/bridgeTimes";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import { settingsStore, walletStore } from "$lib/stores";
import { routesStopped, stubWalletNetwork } from "$lib/test-helpers";
import { outcomeUnknown } from "$lib/transactions";
import { account } from "$lib/web3/walletConnection";

import { Bridge } from "..";
import { networks } from "@dusk-network/networks";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { PAID } from "$lib/bridge/__tests__/fixtures/withdrawal-recipient";

const { CONNECTED, estimateGas, getGasPrice, pendingDepositAmountLux } =
  vi.hoisted(() => ({
    CONNECTED: {
      address: "0x2222222222222222222222222222222222222222",
      chainId: 745,
      isConnected: true,
    },
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    pendingDepositAmountLux: vi.fn(() => 0n),
  }));

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  estimateGas,
  getGasPrice,
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
    modal: { open: vi.fn() },
    wagmiConfig: {},
  };
});

/**
 * A review row's figure, found by its label: its value, as shown.
 *
 * @param {ParentNode} container
 * @param {RegExp} label
 */
const amountOf = (container, label) =>
  Array.from(container.querySelectorAll(".route-review__rows > div"))
    .find((row) =>
      label.test(row.querySelector("dt")?.textContent?.trim() ?? ""),
    )
    ?.querySelector("dd")
    ?.textContent?.replace(/\s+/g, " ")
    .trim();

/**
 * A review row's value, by its label's key word.
 *
 * @param {ParentNode} container
 * @param {RegExp} label
 */
const fieldOf = (container, label) =>
  /** @type {HTMLElement | null} */ (
    Array.from(container.querySelectorAll("dt")).find((term) =>
      label.test(term.textContent?.trim() ?? ""),
    )?.nextElementSibling ?? null
  );

/**
 * What a review amount's label says of it, found by its key word: a bound
 * ("at most") or an estimate ("about").
 *
 * @param {ParentNode} container
 * @param {RegExp} label
 */
const termOf = (container, label) =>
  Array.from(
    container.querySelectorAll(".route-review__rows dt"),
    (term) => term.textContent?.trim() ?? "",
  ).find((term) => label.test(term)) ?? "";

/**
 * The full address a review row gives, as shown.
 *
 * @param {ParentNode} container
 * @param {RegExp} label
 */
const addressOf = (container, label) =>
  fieldOf(container, label)?.querySelector(".full-address")?.textContent;

/**
 * What the card says where a screen reader hears it: its warnings and
 * refusals.
 *
 * @param {HTMLElement} container
 */
const said = (container) =>
  Array.from(
    container.querySelectorAll("[role=alert], [role=status]"),
    (region) => region.textContent?.trim(),
  ).filter(Boolean);

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
    // A testnet account: the withdrawal pays it.
    unshieldedAddress: PAID,
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
        ?.getAttribute("data-value"),
    );

  /** @param {HTMLElement} container */
  const withdraw = (container) =>
    fireEvent.click(
      /** @type {HTMLButtonElement} */ (
        container.querySelector("button[aria-label='Swap From and To']")
      ),
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
    pendingDepositAmountLux.mockReset();
    settingsStore.reset();
    /** @type {import("svelte/store").Writable<any>} */ (account).set(
      CONNECTED,
    );
  });

  describe("a deposit's own form", () => {
    const seed = new Uint8Array(64).fill(5);
    const generator = new ProfileGenerator(async () => seed);

    /** A lock or a reload: the wallet goes before what shows it. */
    async function lockAndUnlock() {
      walletStore.reset();
      cleanup();
      await walletStore.init(generator);
    }

    /**
     * Its 12 DUSK, reviewed and bridged.
     *
     * @param {import("@testing-library/svelte").RenderResult<any>} view
     */
    async function sendDeposit({ getByRole }) {
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Bridge 12 DUSK" }));
    }

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["performance"] });
      stubWalletNetwork();
      await walletStore.init(generator);
    });

    afterEach(() => {
      cleanup();
      walletStore.reset();
      vi.useRealTimers();
    });

    it("should bring the amount and the direction back after a lock, and let them go as it's sent", async () => {
      const typed = render(Bridge, baseProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "12" },
      });
      await lockAndUnlock();

      const back = render(Bridge, baseProps);

      expect(back.getByLabelText("Amount")).toHaveValue("12");
      expect(getDirection(back.container)).toStrictEqual(["duskDs", "duskEvm"]);

      const deposit = vi
        .spyOn(walletStore, "depositEvmFunctionCall")
        .mockReturnValue(new Promise(() => {}));

      await sendDeposit(back);

      expect(deposit).toHaveBeenCalledOnce();

      await lockAndUnlock();

      expect(render(Bridge, baseProps).getByLabelText("Amount")).toHaveValue(
        "",
      );

      deposit.mockRestore();
    });

    it("should hide what Max fills in while balances are hidden, there and on its review, show it there when asked, and bridge it all the same", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const deposit = vi
        .spyOn(walletStore, "depositEvmFunctionCall")
        .mockReturnValue(new Promise(() => {}));
      const { container, getByLabelText, getByRole } = render(
        Bridge,
        baseProps,
      );
      const arriving = () =>
        container.querySelector(".swap-amount output")?.textContent ?? "";

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // The public balance past the fee, 999.98: in no field, nor read out.
      expect(
        /** @type {HTMLInputElement} */ (getByLabelText("Amount")).value,
      ).not.toMatch(/\d/);
      expect(arriving()).not.toMatch(/\d/);

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(amountOf(container, /^amount$/i)).not.toMatch(/\d/);
      expect(amountOf(container, /^total\b/i)).not.toMatch(/\d/);
      expect(
        getByRole("button", { name: /^Bridge\b/ }),
      ).not.toHaveAccessibleName(/\d/);

      await fireEvent.click(getByRole("button", { name: "Show amount" }));

      expect(amountOf(container, /^amount$/i)).toBe("999.98 DUSK");
      expect(amountOf(container, /^total\b/i)).toBe("1,000 DUSK");

      const bridge = getByRole("button", { name: "Bridge 999.98 DUSK" });

      expect(bridge).toBeEnabled();

      await afterConfirmDelay();
      await fireEvent.click(bridge);

      expect(deposit).toHaveBeenCalledOnce();
      expect(deposit.mock.calls[0][1]).toBe(999_980_000_000n);
      deposit.mockRestore();
    });

    it("should go back to its review with Try again when nothing went out, and keep what's typed", async () => {
      const deposit = vi
        .spyOn(walletStore, "depositEvmFunctionCall")
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockReturnValue(new Promise(() => {}));
      const typed = render(Bridge, baseProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "12" },
      });
      await sendDeposit(typed);
      await fireEvent.click(
        await typed.findByRole("button", { name: "Try again" }),
      );

      expect(typed.getByRole("heading", { name: "Review" })).toBeVisible();

      await lockAndUnlock();

      expect(render(Bridge, baseProps).getByLabelText("Amount")).toHaveValue(
        "12",
      );

      deposit.mockRestore();
    });

    it("should offer no Try again when it may have gone out, and keep nothing", async () => {
      const deposit = vi
        .spyOn(walletStore, "depositEvmFunctionCall")
        .mockRejectedValueOnce(
          outcomeUnknown(new TypeError("Failed to fetch")),
        );
      const typed = render(Bridge, baseProps);

      await fireEvent.input(typed.getByLabelText("Amount"), {
        target: { value: "12" },
      });
      await sendDeposit(typed);
      await vi.waitFor(() =>
        expect(
          typed.container.querySelector(".dusk-error-alert"),
        ).not.toBeNull(),
      );

      // Not confirmed, as it may have gone out.
      expect(
        typed.container.querySelector(".dusk-error-alert__summary"),
      ).toHaveTextContent(/not confirmed/i);
      expect(
        typed.container.querySelector(".dusk-error-alert__description"),
      ).toHaveTextContent(/may have gone out/i);
      expect(
        typed.container.querySelector(".dusk-error-alert__description"),
      ).not.toHaveTextContent(/nothing was sent|not sent/i);
      expect(typed.queryByRole("button", { name: "Try again" })).toBeNull();

      await lockAndUnlock();

      expect(render(Bridge, baseProps).getByLabelText("Amount")).toHaveValue(
        "",
      );

      deposit.mockRestore();
    });
  });

  it("should say what is available, and use it all but the deposit's fee on Max", async () => {
    const { getByLabelText, getByRole } = render(Bridge, baseProps);
    const amount = getByLabelText("Amount");

    expect(amount).toHaveAccessibleDescription(/(^|\s)1,000 DUSK$/);

    await fireEvent.click(getByRole("button", { name: "Max" }));

    // The public balance, past the deposit's fee.
    expect(amount).toHaveValue("999.98");
  });

  it("should keep what's needed to get at what's elsewhere on a deposit's Max, say so, and warn of an amount over that", async () => {
    const { container, getByLabelText, getByRole } = render(Bridge, {
      ...baseProps,
      keepForLater: { lux: 60_000_000n, why: "to claim your withdrawal" },
    });
    const amount = getByLabelText("Amount");

    await fireEvent.click(getByRole("button", { name: "Max" }));

    // The public balance, past the deposit's fee and what's kept, which its
    // note says, with no warning.
    expect(amount).toHaveValue("999.92");
    expect(container.querySelector(".swap-note")).toHaveTextContent(
      /(^|\s)0\.06 DUSK\b/,
    );
    expect(said(container)).toStrictEqual([]);

    await fireEvent.input(amount, { target: { value: "999.95" } });

    // Over it: a warning that it leaves too little, and no note.
    expect(said(container)).toStrictEqual([
      expect.stringMatching(/too little/i),
    ]);
    expect(container.querySelector(".swap-note")).toBeNull();

    await fireEvent.input(amount, { target: { value: "999.9" } });

    expect(said(container)).toStrictEqual([]);
    expect(container.querySelector(".swap-note")).toBeNull();
  });

  it("should leave room for a withdrawal's fee when using it all", async () => {
    const { container, getByLabelText, getByRole } = render(Bridge, baseProps);

    await withdraw(container);

    expect(getByLabelText("Amount")).toHaveAccessibleDescription(/\s3 DUSK$/);

    await fireEvent.click(getByRole("button", { name: "Max" }));
    await vi.waitFor(() =>
      // 3 DUSK, less twice the estimated fee.
      expect(getByLabelText("Amount")).toHaveValue("2.997230463"),
    );
  });

  it("should drop a withdrawal's maximum that comes back after the amount, the profile or the direction changed", async () => {
    const { container, getByLabelText, getByRole, rerender } = render(
      Bridge,
      baseProps,
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
      fireEvent.input(amount, { target: { value: "1.5" } }),
    );

    expect(amount).toHaveValue("1.5");

    await askMaxThen(() => rerender({ unshieldedAccount: {} }));

    expect(amount).toHaveValue("1.5");

    await askMaxThen(() =>
      fireEvent.click(getByRole("button", { name: "Swap From and To" })),
    );

    expect(getDirection(container)).toStrictEqual(["duskDs", "duskEvm"]);
    expect(amount).toHaveValue("1.5");
  });

  it("should show a withdrawal's estimated fee, and when it can be proved and claimed on Dusk, before it is sent", async () => {
    const { container, getByRole } = render(Bridge, baseProps);

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    await vi.waitFor(() =>
      expect(amountOf(container, /fee/i)).toBe("0.0014 DUSK"),
    );
    expect(amountOf(container, /^amount$/i)).toBe("2.5 DUSK");
    // The fee is an estimate, never said as the most it costs.
    expect(termOf(container, /fee/i)).toMatch(/\babout\b/i);
    expect(termOf(container, /fee/i)).not.toMatch(/\bat most\b/i);

    // Prove about 30 minutes after sending, then claim 7 days after
    // proving: never before.
    const next = container.querySelector(".banner__title");

    expect(next).toHaveTextContent(
      /\bclaim (?:about )?7 days after (?:you )?prov(?:e|ing)\b/i,
    );
    expect(next).toHaveTextContent(
      /\bprove (?:about )?30 minutes after sending\b/i,
    );
  });

  it("should show the amount, the network fee and the total when reviewing a deposit", async () => {
    const { container, getByRole } = render(Bridge, baseProps);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    // The amount, and the fee and the total, each at most, each under its
    // own label.
    expect(amountOf(container, /^amount$/i)).toBe("2.5 DUSK");
    expect(amountOf(container, /^fee up to$/i)).toBe("0.02 DUSK");
    expect(amountOf(container, /^total\b/i)).toBe("2.52 DUSK");
    expect(termOf(container, /fee/i)).toBe("Fee up to");
    expect(termOf(container, /total/i)).toMatch(/\bup to\b/i);
    // From this public account to the connected DuskEVM account, through the
    // contract the network's file names, shown shortened.
    expect(addressOf(container, /^from$/i)).toBe(PAID);
    expect(addressOf(container, /^to$/i)).toBe(CONNECTED.address);
    // The named contract under Details, closed: reference, not a step.
    const details = /** @type {HTMLDetailsElement} */ (
      container.querySelector("details.route-review__details")
    );

    expect(details.open).toBe(false);
    expect(fieldOf(details, /^contract$/i)).toHaveTextContent(
      /(^|\s)2257e5…a1b31d$/,
    );
    // One button sends it, and under it, that it can't be undone.
    const bridge = getByRole("button", { name: "Bridge 2.5 DUSK" });

    expect(bridge.nextElementSibling).toHaveTextContent(/^Can't be undone\.$/);
  });

  it("should take new default gas, as the node's price, until the review", async () => {
    const { container, getByRole, rerender } = render(Bridge, baseProps);
    const { gasLimit } = baseProps.gasSettings;

    await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(amountOf(container, /fee/i)).toBe("0.06 DUSK");

    // Not while reviewing: the fee reviewed is the fee sent.
    await rerender({ gasSettings: { gasLimit, gasPrice: 5n } });

    expect(amountOf(container, /fee/i)).toBe("0.06 DUSK");
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

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });

    // The same amount reviewed twice: the first estimate comes back last.
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Review" }));
    estimates[1].resolve(200_000n);
    await settle();
    estimates[0].resolve(100_000n);
    await settle();

    // 200,000 gas at 10.001 gwei.
    expect(amountOf(container, /fee/i)).toBe("0.002 DUSK");

    // Another profile while the estimate runs: the fee isn't its, and the
    // review gives the amount alone.
    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await rerender({ unshieldedAccount: {} });
    estimates[2].resolve(300_000n);
    await settle();

    expect(amountOf(container, /^amount$/i)).toBe("2.5 DUSK");
    expect(amountOf(container, /fee/i)).toBeUndefined();
    // With no fee, no total.
    expect(amountOf(container, /total/i)).toBeUndefined();
  });

  it("should show only the amount when reviewing a withdrawal whose fee can't be estimated", async () => {
    estimateGas.mockRejectedValue(new Error("RPC unavailable"));
    getGasPrice.mockImplementation(() => {
      throw new Error("Chain not configured");
    });

    const { container, getByRole } = render(Bridge, baseProps);

    await withdraw(container);
    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(amountOf(container, /^amount$/i)).toBe("2.5 DUSK");
    expect(amountOf(container, /fee/i)).toBeUndefined();
    // With no fee, no total.
    expect(amountOf(container, /total/i)).toBeUndefined();
  });

  it("should hide the public balance and the deposit on its way while balances are hidden, but not the Review amounts", async () => {
    pendingDepositAmountLux.mockReturnValue(1_500_000_000n);
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(Bridge, baseProps);

    // Neither the public balance's 1,000 DUSK nor the 1.5 on its way.
    expect(container).not.toHaveTextContent("1,000");
    expect(container).not.toHaveTextContent("1.5");

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(amountOf(container, /^amount$/i)).toBe("2.5 DUSK");
    expect(amountOf(container, /fee/i)).toBe("0.02 DUSK");
    expect(amountOf(container, /total/i)).toBe("2.52 DUSK");
  });

  it("should say what stops a review on the card's one button", async () => {
    const { getByRole } = render(Bridge, baseProps);
    const amount = getByRole("textbox");

    expect(getByRole("button", { name: "Enter an amount" })).toBeDisabled();

    await fireEvent.input(amount, { target: { value: "5000" } });

    expect(getByRole("button", { name: "Not enough DUSK" })).toBeDisabled();
    expect(getByRole("alert")).toBeInTheDocument();

    await fireEvent.input(amount, { target: { value: "2.5" } });

    expect(getByRole("button", { name: "Review" })).toBeEnabled();
  });

  it("should pick the networks from lists, as the network's routes go", async () => {
    // Testnet's routes to its BSC test chain stopped.
    setNodeNetwork(routesStopped(networks.testnet));

    const { container, getByRole } = render(Bridge, baseProps);

    await fireEvent.click(
      getByRole("button", { name: "From: Dusk. Choose the network" }),
    );

    // A route that isn't running: listed, and not picked.
    expect(getByRole("option", { name: /BSC test chain/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await fireEvent.click(getByRole("option", { name: /DuskEVM/ }));

    expect(getDirection(container)).toStrictEqual(["duskEvm", "duskDs"]);
  });

  it("should leave the review for the form when the EVM wallet disconnects", async () => {
    const { getByRole, queryByRole } = render(Bridge, baseProps);

    await fireEvent.input(getByRole("textbox"), { target: { value: "2.5" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: "Bridge 2.5 DUSK" })).toBeEnabled();

    /** @type {import("svelte/store").Writable<any>} */ (account).set({
      isConnected: false,
    });
    await tick();

    expect(queryByRole("button", { name: "Bridge 2.5 DUSK" })).toBeNull();
    expect(
      getByRole("button", { name: "Connect a DuskEVM wallet" }),
    ).toBeEnabled();
  });
});
