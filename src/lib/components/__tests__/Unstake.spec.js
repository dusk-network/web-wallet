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
import { outcomeUnknown } from "$lib/transactions";

import { Unstake } from "..";
import { mdiDatabaseArrowDownOutline, mdiGiftOpenOutline } from "@mdi/js";

/**
 * The Review step's amounts, as their values.
 *
 * @param {HTMLElement} container
 */
const getReviewValues = (container) =>
  Array.from(container.querySelectorAll(".review-amount dd"), (value) =>
    value.textContent?.trim(),
  );

/**
 * Matches `value` whole: not inside a longer figure, nor signed, so "1 DUSK"
 * matches neither "11 DUSK", "0.1 DUSK" nor a signed "1 DUSK".
 *
 * @param {string} value As the page writes it, as "0.02 DUSK"
 */
const wholeFigure = (value) =>
  new RegExp(`(?<![^ ])${value.replaceAll(".", "[.]")}(?![.,]?[0-9])`);

/** What a send that failed came to, as its heading says it. */
const failureOf = () => document.querySelector(".dusk-error-alert__summary");

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

  it("should start with all it can take in the language set, whatever the browser's, for Next to take it", async () => {
    settingsStore.update((store) => ({ ...store, language: "de-DE" }));

    const { getByRole } = render(Unstake, {
      ...baseProps,
      availableBalance: 10_000_000_000_000n,
      maxWithdrawAmount: 1_123_000_000n,
      minStakeRequirement: 1_000_000_000n,
      operationCtaIconPath: mdiDatabaseArrowDownOutline,
      operationCtaLabel: "Unstake",
      operationOverviewLabel: "Amount to unstake",
    });

    expect(navigator.language).not.toMatch(/^de/);
    // A fourth decimal, so that it reads back as 1.123, never as 1123.
    expect(getByRole("textbox", { name: /Amount/ })).toHaveValue("1,1230");
    expect(getByRole("button", { name: "Review" })).toBeEnabled();
  });

  describe("Unstake operation", () => {
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

    it("should show the amount and the network fee on the review step, and no total", async () => {
      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getReviewValues(container)).toStrictEqual([
        "278 DUSK",
        "0.02 DUSK",
      ]);
    });

    it("should hide the amount it starts at, all that is staked, while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const amountInput = /** @type {HTMLInputElement} */ (
        getByRole("textbox", { name: "Amount" })
      );

      await vi.advanceTimersToNextTimerAsync();

      // All that is staked, 278 DUSK, filled in, with no figure in the field
      // nor anywhere on the screen.
      expect(amountInput.value).not.toBe("");
      expect(amountInput.value).not.toMatch(/[0-9]/);
      expect(container.textContent).not.toMatch(/278/);
      expect(getByRole("button", { name: "Review" })).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getReviewValues(container)[0]).not.toMatch(/[0-9]/);
      expect(container.textContent).not.toMatch(/278/);
    });

    it("should show the amount once it's typed, not when Max fills it in, while balances are hidden", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { getByRole } = render(Unstake, { ...baseProps, ...unstakeProps });
      const amountInput = /** @type {HTMLInputElement} */ (
        getByRole("textbox", { name: "Amount" })
      );

      await vi.advanceTimersToNextTimerAsync();

      expect(amountInput.value).not.toMatch(/[0-9]/);

      await fireEvent.input(amountInput, { target: { value: "100" } });

      expect(amountInput).toHaveValue("100");

      await fireEvent.input(amountInput, { target: { value: "" } });
      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(amountInput.value).not.toBe("");
      expect(amountInput.value).not.toMatch(/[0-9]/);

      // Deleting a character of what shows clears it.
      await fireEvent.input(amountInput, {
        target: { value: amountInput.value.slice(1) },
      });

      expect(amountInput).toHaveValue("");
    });

    it("should take an amount as the other amount fields do, with a decimal point or comma", async () => {
      const { container, getByRole } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const amountInput = getByRole("textbox", { name: "Amount" });

      for (const typed of ["100,5", "100.5"]) {
        await fireEvent.input(amountInput, { target: { value: typed } });
        await fireEvent.click(getByRole("button", { name: "Review" }));

        expect(getReviewValues(container)[0]).toBe("100.5 DUSK");

        await fireEvent.click(getByRole("button", { name: "Back" }));
      }

      await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
        target: { value: "100,5" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledWith(
        100_500_000_000n,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit,
      );
    });

    it("should say what's wrong with an amount in the other amount fields' words, and not go on", async () => {
      const { getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const amountInput = getByRole("textbox", { name: "Amount" });
      /** What's said of an amount that can't go on, or null for one that can. */
      const errorOf = async (/** @type {string} */ typed) => {
        await fireEvent.input(amountInput, { target: { value: typed } });

        return getByRole("button", { name: "Review" }).hasAttribute("disabled")
          ? (document.querySelector(".operation__error")?.textContent?.trim() ??
              "")
          : null;
      };

      // Not an amount: an example of one.
      expect(await errorOf("ten")).toMatch(wholeFigure("10.5"));
      // More decimals than DUSK's nine.
      expect(await errorOf("1.0000000001")).toMatch(wholeFigure("9 decimals"));
      expect(await errorOf("0")).toMatch(/more than 0(?![.,]?[0-9])/);
      // More than is staked.
      expect(await errorOf("278,5")).toMatch(/more than/i);
      // Less than the 1 DUSK a stake must keep, unless it all goes.
      expect(await errorOf("277.5")).toMatch(/at least/i);
      expect(await errorOf("277.5")).toMatch(wholeFigure("1 DUSK"));
      expect(await errorOf("277")).toBeNull();

      await rerender({ availableBalance: 0n });

      // The fee it can't pay, which the public balance pays.
      expect(await errorOf("278")).toMatch(wholeFigure("0.02 DUSK"));
    });

    it("should take new default gas, as the node's price, until the review", async () => {
      const { container, getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });
      const { gasLimit } = baseProps.gasSettings;

      await vi.advanceTimersToNextTimerAsync();
      await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getReviewValues(container)[1]).toBe("0.06 DUSK");
    });

    it("should perform an unstake, and say it's on its way", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = { ...baseProps, ...unstakeProps };

      const { findByRole, getByRole } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      await fireEvent.click(getByRole("button", { name: "Review" }));

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        unstakeProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit,
      );
      await findByRole("status");
      expect(
        document.querySelector(".transaction-status--pending"),
      ).not.toBeNull();
    });

    it("should send once, and nothing more once the stake read again after it settles shows less", async () => {
      const { container, getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...unstakeProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Review" }));
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
        baseProps.gasSettings.gasLimit,
      );
      expect(
        container.querySelector(".tx-result, [role='status']"),
      ).toBeTruthy();
    });

    it("should take no click on Unstake for half a second once the review shows, so a double click on Next can't send", async () => {
      const { getByRole } = render(Unstake, { ...baseProps, ...unstakeProps });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Review" }));

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
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await rerender({ maxWithdrawAmount: 100_000_000_000n });

      expect(getReviewValues(container)[0]).toBe("278 DUSK");

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Unstake" }));

      expect(baseProps.execute).toHaveBeenCalledOnce();
      expect(baseProps.execute).toHaveBeenCalledWith(
        278_000_000_000n,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit,
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

      const nextButton = getByRole("button", { name: "Review" });

      expect(nextButton).toBeDisabled();
    });
  });

  describe("Claim Rewards operation", () => {
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

    it("should go back to the review with Try again when nothing went out, and send what it shows", async () => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(lastTxId);
      const { container, findByRole, getByRole } = render(Unstake, {
        ...baseProps,
        ...claimRewardsProps,
        execute,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));

      const tryAgain = await findByRole("button", { name: "Try again" });

      // Nothing went out.
      expect(failureOf()).toHaveTextContent(/not sent/i);

      await fireEvent.click(tryAgain);

      expect(getReviewValues(container)[0]).toBe("345 DUSK");
      expect(execute).toHaveBeenCalledOnce();

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenLastCalledWith(
        claimRewardsProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit,
      );
      await findByRole("status");
      expect(
        document.querySelector(".transaction-status--pending"),
      ).not.toBeNull();
    });

    it("should offer no Try again when it may have gone out", async () => {
      const execute = vi
        .fn()
        .mockRejectedValue(outcomeUnknown(new TypeError("Failed to fetch")));
      const { findByRole, getByRole, queryByRole } = render(Unstake, {
        ...baseProps,
        ...claimRewardsProps,
        execute,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));

      expect(await findByRole("link", { name: "Open Activity" })).toBeVisible();
      expect(failureOf()).toHaveTextContent(/not confirmed/i);
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("should perform a claim rewards, and say it's on its way", async () => {
      /** @type {import("svelte").ComponentProps<Unstake>} */
      const props = { ...baseProps, ...claimRewardsProps };

      const { findByRole, getByRole } = render(Unstake, props);

      await vi.advanceTimersToNextTimerAsync();

      await fireEvent.click(getByRole("button", { name: "Review" }));

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));

      expect(baseProps.execute).toHaveBeenCalledTimes(1);
      expect(baseProps.execute).toHaveBeenCalledWith(
        claimRewardsProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit,
      );
      await findByRole("status");
      expect(
        document.querySelector(".transaction-status--pending"),
      ).not.toBeNull();
    });

    it("should claim once, and nothing more once the rewards read again after it settles are none", async () => {
      const { getByRole, rerender } = render(Unstake, {
        ...baseProps,
        ...claimRewardsProps,
      });

      await vi.advanceTimersToNextTimerAsync();
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Claim Rewards" }));
      await rerender({ maxWithdrawAmount: 0n });
      await vi.advanceTimersToNextTimerAsync();

      expect(baseProps.execute).toHaveBeenCalledOnce();
      expect(baseProps.execute).toHaveBeenCalledWith(
        claimRewardsProps.maxWithdrawAmount,
        baseProps.gasSettings.gasPrice,
        baseProps.gasSettings.gasLimit,
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

      expect(getByRole("alert")).toHaveTextContent(/more than/i);
      expect(getByRole("button", { name: "Review" })).toBeDisabled();
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

      const nextButton = getByRole("button", { name: "Review" });

      expect(nextButton).toBeDisabled();
    });
  });
});
