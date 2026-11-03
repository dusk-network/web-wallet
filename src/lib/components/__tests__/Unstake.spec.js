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
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
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
  const lastTxId =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";

  const baseProps = {
    execute: vi.fn().mockResolvedValue(lastTxId),
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

      const { getByRole } = render(Unstake, baseOptions);
      const nextButton = getByRole("button", { name: "Next" });

      expect(nextButton).toBeEnabled();
    });

    it("should show the amount and the network fee on the review step, and no total", async () => {
      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getReviewAmounts(container)).toStrictEqual([
        ["Unstake Amount", "278 DUSK"],
        ["Network fee (at most)", "0.02 DUSK"],
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
      const amountInput = getByRole("textbox", { name: "Amount" });

      await vi.advanceTimersToNextTimerAsync();

      expect(amountInput).toHaveValue("");
      expect(amountInput).toHaveAttribute("placeholder", "••••");
      expect(amountInput).toHaveAccessibleDescription("hidden");
      expect(getByRole("button", { name: "Next" })).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getReviewAmounts(container)[0]).toStrictEqual([
        "Unstake Amount",
        "278 DUSK",
      ]);
    });

    it("should show the amount once it's typed or set to the maximum, while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { getByRole } = render(Unstake, { ...baseProps, ...unstakeProps });
      const amountInput = getByRole("textbox", { name: "Amount" });

      await vi.advanceTimersToNextTimerAsync();

      expect(amountInput).toHaveValue("");

      await fireEvent.input(amountInput, { target: { value: "100" } });

      expect(amountInput).toHaveValue("100");
      expect(amountInput).not.toHaveAccessibleDescription("hidden");

      await fireEvent.input(amountInput, { target: { value: "" } });
      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(amountInput).toHaveValue("278");
    });

    it("should take an amount as the other amount fields do: as text, with a decimal point or comma", async () => {
      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const amountInput = getByRole("textbox", { name: "Amount" });

      expect(amountInput).toHaveAttribute("type", "text");
      expect(amountInput).toHaveAttribute("inputmode", "decimal");
      expect(container.querySelector("input[type='number']")).toBeNull();

      for (const typed of ["100,5", "100.5"]) {
        await fireEvent.input(amountInput, { target: { value: typed } });
        await fireEvent.click(getByRole("button", { name: "Next" }));

        expect(getReviewAmounts(container)[0]).toStrictEqual([
          "Unstake Amount",
          "100.5 DUSK",
        ]);

        await fireEvent.click(getByRole("button", { name: "Back" }));
      }

      await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
        target: { value: "100,5" },
      });
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledWith(
        100_500_000_000n,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
    });

    it("should say what's wrong with an amount in the other amount fields' words, and not go on", async () => {
      const { getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const amountInput = getByRole("textbox", { name: "Amount" });
      const errorOf = async (/** @type {string} */ typed) => {
        await fireEvent.input(amountInput, { target: { value: typed } });

        return getByRole("button", { name: "Next" }).hasAttribute("disabled")
          ? (document.querySelector(".operation__error")?.textContent?.trim() ??
              "")
          : null;
      };

      expect(await errorOf("ten")).toBe("Enter an amount such as 10 or 10.5.");
      expect(await errorOf("1.0000000001")).toBe(
        "Enter an amount such as 10 or 10.5."
      );
      expect(await errorOf("0")).toBe("Enter an amount greater than 0.");
      expect(await errorOf("278,5")).toBe("That's more than you have staked.");
      expect(await errorOf("277.5")).toBe(
        "Leave at least 1 DUSK staked, or unstake it all."
      );
      expect(await errorOf("277")).toBeNull();

      await rerender({ availableBalance: 0n });

      expect(await errorOf("278")).toBe(
        "The network fee is paid from the public balance, and it's empty."
      );
    });

    it("should take new default gas, as the node's price, until the review", async () => {
      const { container, getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const { gasLimit } = baseProps.gasSettings;

      await vi.advanceTimersToNextTimerAsync();
      await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
      await fireEvent.click(getByRole("button", { name: "Next" }));

      expect(getReviewAmounts(container)[1]).toStrictEqual([
        "Network fee (at most)",
        "0.06 DUSK",
      ]);
    });

    it("should perform an ustake, give a success message and supply a link to see the transaction in the explorer", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = { ...baseProps, ...unstakeProps };

      const { findByRole, getByRole, getByText } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      await fireEvent.click(getByRole("button", { name: "Next" }));

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        unstakeProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      expect(await findByRole("status")).toHaveTextContent(/^Sending… /);
      expect(getByText("8dcf6f…3db55e")).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should send once, and nothing more once the stake read again after it settles shows less", async () => {
      const { container, getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      // It settled: nothing staked now, and the fee paid.
      await rerender({ availableBalance: 9_999_000_000_000n });
      await rerender({ maxWithdrawAmount: 0n });
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledOnce();
      expect(baseProps.execute).toHaveBeenCalledWith(
        unstakeProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
      expect(
        container.querySelector(".tx-result, [role='status']")
      ).toBeTruthy();
    });

    it("should take no click on Unstake for half a second once the review shows, so a double click on Next can't send", async () => {
      const { getByRole } = render(Unstake, { ...baseProps, ...unstakeProps });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Next" }));

      // Next's second click lands where Unstake now is, and so does Enter.
      await fireEvent.click(getByRole("button", { name: "Unstake" }));
      await fireEvent.click(getByRole("button", { name: "Unstake" }), {
        detail: 0,
      });
      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(getByRole("button", { name: "Unstake" })).toBeEnabled();

      await vi.advanceTimersByTimeAsync(1);
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledOnce();
    });

    it("should send the amount the review shows, though the stake is read again while it shows", async () => {
      const { container, getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await rerender({ maxWithdrawAmount: 100_000_000_000n });

      expect(getReviewAmounts(container)[0]).toStrictEqual([
        "Unstake Amount",
        "278 DUSK",
      ]);

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledOnce();
      expect(baseProps.execute).toHaveBeenCalledWith(
        278_000_000_000n,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
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

      const { getByRole } = render(Unstake, baseOptions);
      const nextButton = getByRole("button", { name: "Next" });

      expect(nextButton).toBeEnabled();
    });

    it("should perform a claim rewards, give a success message and supply a link to see the transaction in the explorer", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = { ...baseProps, ...claimRewardsProps };

      const { findByRole, getByRole, getByText } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      await fireEvent.click(getByRole("button", { name: "Next" }));

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        claimRewardsProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );

      const explorerLink = getByRole("link", { name: /explorer/i });

      expect(await findByRole("status")).toHaveTextContent(/^Sending… /);
      expect(getByText("8dcf6f…3db55e")).toBeInTheDocument();
      expect(explorerLink).toHaveAttribute("target", "_blank");
      expect(explorerLink).toHaveAttribute("href", expectedExplorerLink);
    });

    it("should claim once, and nothing more once the rewards read again after it settles are none", async () => {
      const { getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...claimRewardsProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));
      await rerender({ maxWithdrawAmount: 0n });
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledOnce();
      expect(baseProps.execute).toHaveBeenCalledWith(
        claimRewardsProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit
      );
    });

    it("should say when an amount is more than the rewards", async () => {
      const { getByRole } = render(Unstake, {
        ...baseProps,
        ...claimRewardsProps,
      });

      await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
        target: { value: "345,1" },
      });

      expect(getByRole("alert")).toHaveTextContent(
        "That's more than your rewards."
      );
      expect(getByRole("button", { name: "Next" })).toBeDisabled();
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
