import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";
import { settingsStore } from "$lib/stores";

import { Unstake } from "..";
import { mdiDatabaseArrowDownOutline, mdiGiftOpenOutline } from "@mdi/js";

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

// The transaction sent stays pending.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

describe("Unstake", () => {
  const formatter = createCurrencyFormatter("en", "DUSK", 9);
  const lastTxId =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";

  const baseProps = {
    execute: vi.fn().mockResolvedValue(lastTxId),
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
  };

  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    settingsStore.reset();
  });

  describe("Unstake operation", () => {
    const expectedExplorerLink = `/explorer/transactions/transaction?id=${lastTxId}`;

    const unstakeProps = {
      availableBalance: 10_000_000_000_000n,
      maxWithdrawAmount: 278_000_000_000n,
      minStakeRequirement: 1_000_000_000n,
      operationCtaIconPath: mdiDatabaseArrowDownOutline,
      operationCtaLabel: "Unstake",
      operationOverviewLabel: "Unstake Amount",
    };

    beforeAll(() => {
      vi.useFakeTimers();
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it("should render the unstake view", () => {
      const baseOptions = {
        props: {
          ...baseProps,
          ...unstakeProps,
        },
        target: document.body,
      };

      const { container, getByRole } = render(Unstake, baseOptions);
      const nextButton = getByRole("button", { name: "Next" });

      expect(nextButton).toBeEnabled();
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should show the amount and the network fee on the review step, and no total", async () => {
      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const fee =
        baseProps.gasSettings.gasLimit * baseProps.gasSettings.gasPrice;

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getReviewAmounts(container)).toStrictEqual([
        [
          "Unstake Amount",
          `${formatter(luxToDusk(unstakeProps.maxWithdrawAmount))} DUSK`,
        ],
        ["Network fee (at most)", `${formatter(luxToDusk(fee))} DUSK`],
      ]);
      expect(container.querySelector("dt .dusk-icon")).toBeNull();
      expect(container.querySelector(".gas-fee")).toBeNull();
    });

    it("should hide the amount it starts at, all that is staked, while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const amountInput = getByRole("spinbutton");

      await vi.advanceTimersToNextTimerAsync();

      expect(amountInput).toHaveValue(null);
      expect(amountInput).toHaveAttribute("placeholder", "••••");
      expect(amountInput).toHaveAccessibleDescription("hidden");
      expect(getByRole("button", { name: "Next" })).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getReviewAmounts(container)[0]).toStrictEqual([
        "Unstake Amount",
        `${formatter(luxToDusk(unstakeProps.maxWithdrawAmount))} DUSK`,
      ]);
    });

    it("should show the amount once it's typed or set to the maximum, while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { getByRole } = render(Unstake, { ...baseProps, ...unstakeProps });
      const amountInput = getByRole("spinbutton");

      await vi.advanceTimersToNextTimerAsync();

      expect(amountInput).toHaveValue(null);

      await fireEvent.input(amountInput, { target: { value: 100 } });

      expect(amountInput).toHaveValue(100);
      expect(amountInput).not.toHaveAccessibleDescription();

      await fireEvent.click(getByRole("button", { name: "USE MAX" }));

      expect(amountInput).toHaveValue(
        luxToDusk(unstakeProps.maxWithdrawAmount)
      );
    });

    it("should perform an ustake, give a success message and supply a link to see the transaction in the explorer", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = { ...baseProps, ...unstakeProps };

      const { findByRole, getByRole, getByText } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      await fireEvent.click(getByRole("button", { name: "Next" }));

      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        unstakeProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      expect(await findByRole("status")).toHaveTextContent(/^Sent Pending/);
      expect(getByText("8dcf6f8a...993db55e")).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should not allow to unstake, if wrong gas settings are provided", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = {
        ...baseProps,
        ...unstakeProps,
        gasSettings: { gasLimit: 29000000090n, gasPrice: 1n },
      };

      const { getByRole } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      const nextButton = getByRole("button", { name: "Next" });

      expect(nextButton).toBeDisabled();
    });
  });

  describe("Claim Rewards operation", () => {
    const expectedExplorerLink = `/explorer/transactions/transaction?id=${lastTxId}`;

    const claimRewardsProps = {
      availableBalance: 10_000_000_000_000n,
      maxWithdrawAmount: 345_000_000_000n,
      minStakeRequirement: undefined,
      operationCtaIconPath: mdiGiftOpenOutline,
      operationCtaLabel: "Claim Rewards",
      operationOverviewLabel: "Rewards Amount",
    };

    beforeAll(() => {
      vi.useFakeTimers();
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it("should render the claim rewards view", () => {
      const baseOptions = {
        props: {
          ...baseProps,
          ...claimRewardsProps,
        },
        target: document.body,
      };

      const { container, getByRole } = render(Unstake, baseOptions);
      const nextButton = getByRole("button", { name: "Next" });

      expect(nextButton).toBeEnabled();
      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should perform a claim rewards, give a success message and supply a link to see the transaction in the explorer", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = { ...baseProps, ...claimRewardsProps };

      const { findByRole, getByRole, getByText } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      await fireEvent.click(getByRole("button", { name: "Next" }));

      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        claimRewardsProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      expect(await findByRole("status")).toHaveTextContent(/^Sent Pending/);
      expect(getByText("8dcf6f8a...993db55e")).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should not allow to claim rewards, if wrong gas settings are provided", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = {
        ...baseProps,
        ...claimRewardsProps,
        gasSettings: { gasLimit: 29000000090n, gasPrice: 1n },
      };

      const { getByRole } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      const nextButton = getByRole("button", { name: "Next" });

      expect(nextButton).toBeDisabled();
    });
  });
});
