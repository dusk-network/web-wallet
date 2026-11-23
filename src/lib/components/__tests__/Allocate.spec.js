import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { formatFee } from "$lib/dusk/currency";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { settingsStore, walletStore } from "$lib/stores";
import { onAPhone } from "$lib/test-helpers";
import { outcomeUnknown } from "$lib/transactions";

import { Allocate } from "..";

/** The language's decimal separator, as the browser gives it. */
const separator = vi.hoisted(() => ({ value: "." }));

vi.mock("$lib/dusk/number", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getDecimalSeparator: () => separator.value,
}));

/**
 * The Review step's amounts, as their values.
 *
 * @param {HTMLElement} container
 */
const getReviewValues = (container) =>
  Array.from(container.querySelectorAll(".review-amount dd"), (value) =>
    value.textContent?.trim(),
  );

/** What a send that failed came to, as its heading says it. */
const failureOf = () => document.querySelector(".dusk-error-alert__summary");

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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should take no click on Send for half a second once the review shows, so a double click on Next can't shield", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });

    const shield = vi
      .spyOn(walletStore, "shield")
      .mockReturnValue(new Promise(() => {}));
    const { getByRole } = render(Allocate, baseProps);

    await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
      target: { value: "2500" },
    });

    // Next's second click lands where Send now is, and so does Enter.
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }), {
      detail: 0,
    });
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));

    expect(shield).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Shield 500 DUSK" })).toBeEnabled();

    await vi.advanceTimersByTimeAsync(1);
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));

    expect(shield).toHaveBeenCalledOnce();
  });

  it("should go back to the review with Try again when nothing went out, the amounts kept", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });

    const shield = vi
      .spyOn(walletStore, "shield")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValue(new Promise(() => {}));
    const { container, findByRole, getByRole } = render(Allocate, baseProps);

    await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
      target: { value: "2500" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY);
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));
    const tryAgain = await findByRole("button", { name: "Try again" });

    // Nothing went out.
    expect(failureOf()).toHaveTextContent(/not sent/i);

    await fireEvent.click(tryAgain);

    expect(getReviewValues(container)[0]).toBe("500 DUSK");
    expect(shield).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY);
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));

    expect(shield).toHaveBeenCalledTimes(2);
    expect(shield.mock.calls[1][0]).toBe(500_000_000_000n);
  });

  it("should offer no Try again when it may have gone out", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    vi.spyOn(walletStore, "shield").mockRejectedValueOnce(
      outcomeUnknown(new TypeError("Failed to fetch")),
    );

    const { findByRole, getByRole, queryByRole } = render(Allocate, baseProps);

    await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
      target: { value: "2500" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY);
    await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));

    expect(await findByRole("link", { name: "Open Activity" })).toBeVisible();
    expect(failureOf()).toHaveTextContent(/not confirmed/i);
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
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

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getReviewValues(container)[0]).toBe("1,000 DUSK");
  });

  it("should show the amount, the network fee and the total on the review step", async () => {
    const { container, getByRole } = render(Allocate, baseProps);
    const shieldedInput = getByRole("textbox", { name: "Shielded amount" });

    await fireEvent.input(shieldedInput, { target: { value: "2500" } });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getReviewValues(container)).toStrictEqual([
      "500 DUSK",
      "0.02 DUSK",
      "500.02 DUSK",
    ]);
  });

  it("should take new default gas, as the node's price, until the review, and again once back", async () => {
    const { container, getByRole, rerender } = render(Allocate, baseProps);
    const { gasLimit } = baseProps.gasSettings;

    /** @param {bigint} price */
    const feeAt = (price) =>
      `${formatFee(gasLimit * price, "en", { max: true })} DUSK`;

    await rerender({ gasSettings: { gasLimit, gasPrice: 3n } });
    await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
      target: { value: "2500" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getReviewValues(container)[1]).toBe(feeAt(3n));

    // Not while reviewing: the fee reviewed is the fee sent.
    await rerender({ gasSettings: { gasLimit, gasPrice: 5n } });

    expect(getReviewValues(container)[1]).toBe(feeAt(3n));

    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getReviewValues(container)[1]).toBe(feeAt(5n));
  });

  it("should hide the balances while they're hidden, and show what the user types, checked against them", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(Allocate, baseProps);
    const publicInput = getByRole("textbox", { name: "Public amount" });
    const shieldedInput = getByRole("textbox", { name: "Shielded amount" });
    const nextButton = getByRole("button", { name: "Review" });

    // Neither balance shows: 1,000 DUSK public, 2,000 DUSK shielded.
    expect(
      container.querySelector(".operation__label small"),
    ).not.toHaveTextContent(/[0-9]/);
    expect(publicInput).toHaveValue("");
    expect(shieldedInput).toHaveValue("");

    await fireEvent.input(publicInput, { target: { value: "3500" } });

    // More than both balances: refused, and the other side, which would
    // give the total away, still not shown.
    expect(publicInput).toHaveValue("3500");
    expect(shieldedInput).toHaveValue("");
    expect(nextButton).toBeDisabled();
    expect(container.querySelector(".banner--error")).toHaveTextContent(
      /more than/i,
    );

    await fireEvent.input(shieldedInput, { target: { value: "2500" } });

    expect(shieldedInput).toHaveValue("2500");
    expect(publicInput).toHaveValue("");
    expect(nextButton).toBeEnabled();

    await fireEvent.click(nextButton);

    // What moves is the 2,500 typed less the hidden 2,000: it, and the total
    // with it, would give the balance away. The fee doesn't.
    const [amount, fee, total] = getReviewValues(container);

    expect(amount).not.toMatch(/\d/);
    expect(amount).toMatch(/ DUSK$/);
    expect(fee).toBe("0.02 DUSK");
    expect(total).not.toMatch(/\d/);
    expect(total).toMatch(/ DUSK$/);
    expect(getByRole("button", { name: /^Shield\b/ })).not.toHaveAccessibleName(
      /\d/,
    );
  });

  it("should hide what moves wherever it's worked out from a hidden balance, from either field", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(Allocate, {
      ...baseProps,
      shieldedBalance: {
        spendable: 2_000_250_000_000n,
        value: 2_000_250_000_000n,
      },
      unshieldedBalance: 1_000_500_000_000n,
    });

    // What stays public, typed: what moves is the hidden 1,000.5 less it.
    await fireEvent.input(getByRole("textbox", { name: "Public amount" }), {
      target: { value: "250.25" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    const [amount, fee, total] = getReviewValues(container);

    expect(amount).not.toMatch(/\d/);
    expect(fee).toBe("0.02 DUSK");
    expect(total).not.toMatch(/\d/);
    // Not 750.25, the public balance less what was typed.
    expect(getByRole("button", { name: /^Shield\b/ })).not.toHaveAccessibleName(
      /\d/,
    );
  });

  it("should show what the review hides when asked, before it's confirmed, and shield it all the same", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const shield = vi
      .spyOn(walletStore, "shield")
      .mockReturnValue(new Promise(() => {}));
    const { container, getByRole } = render(Allocate, baseProps);

    // 2,500 typed over the hidden 2,000: what moves, 500, is hidden.
    await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
      target: { value: "2500" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getReviewValues(container)[0]).not.toMatch(/\d/);

    await fireEvent.click(getByRole("button", { name: "Show amount" }));

    expect(getReviewValues(container)).toStrictEqual([
      "500 DUSK",
      "0.02 DUSK",
      "500.02 DUSK",
    ]);

    const confirm = getByRole("button", { name: "Shield 500 DUSK" });

    expect(confirm).toBeEnabled();

    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY);
    await fireEvent.click(confirm);

    expect(shield).toHaveBeenCalledOnce();
    expect(shield.mock.calls[0][0]).toBe(500_000_000_000n);
  });

  it("should show what the review hides on a phone too, as a tap or a screen reader's double tap presses it, say it, and keep the focus where it was pressed", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const phone = onAPhone();
    const shield = vi
      .spyOn(walletStore, "shield")
      .mockReturnValue(new Promise(() => {}));

    try {
      const { container, getAllByRole, getByRole } = render(
        Allocate,
        baseProps,
      );

      await fireEvent.input(getByRole("textbox", { name: "Shielded amount" }), {
        target: { value: "2500" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getReviewValues(container)[0]).not.toMatch(/\d/);

      const show = getByRole("button", { name: "Show amount" });

      // A screen reader's double tap: a click, with no finger held.
      show.focus();
      await fireEvent.click(show);

      expect(getReviewValues(container)).toStrictEqual([
        "500 DUSK",
        "0.02 DUSK",
        "500.02 DUSK",
      ]);
      // Said as it shows, the amount and the total; the focus stays on what
      // showed it, which hides it again.
      expect(
        getAllByRole("status").map((status) => status.textContent),
      ).toContainEqual(expect.stringMatching(/500 DUSK.*500\.02 DUSK/));
      expect(document.activeElement).toBe(
        getByRole("button", { name: "Hide amount" }),
      );

      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY);
      await fireEvent.click(getByRole("button", { name: "Shield 500 DUSK" }));

      expect(shield).toHaveBeenCalledOnce();
      expect(shield.mock.calls[0][0]).toBe(500_000_000_000n);
    } finally {
      phone.mockRestore();
    }
  });

  it("should show what's typed on the review where it's all that moves, into a side that held nothing", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const shield = render(Allocate, {
      ...baseProps,
      shieldedBalance: { spendable: 0n, value: 0n },
      unshieldedBalance: 1_000_500_000_000n,
    });

    await fireEvent.input(
      shield.getByRole("textbox", { name: "Shielded amount" }),
      { target: { value: "250.75" } },
    );
    await fireEvent.click(shield.getByRole("button", { name: "Review" }));

    expect(getReviewValues(shield.container)).toStrictEqual([
      "250.75 DUSK",
      "0.02 DUSK",
      "250.77 DUSK",
    ]);
    expect(
      shield.getByRole("button", { name: "Shield 250.75 DUSK" }),
    ).toBeInTheDocument();

    cleanup();

    const unshield = render(Allocate, {
      ...baseProps,
      shieldedBalance: {
        spendable: 2_000_250_000_000n,
        value: 2_000_250_000_000n,
      },
      unshieldedBalance: 0n,
    });

    await fireEvent.input(
      unshield.getByRole("textbox", { name: "Public amount" }),
      { target: { value: "100.5" } },
    );
    await fireEvent.click(unshield.getByRole("button", { name: "Review" }));

    expect(getReviewValues(unshield.container)[0]).toBe("100.5 DUSK");
    expect(
      unshield.getByRole("button", { name: "Unshield 100.5 DUSK" }),
    ).toBeInTheDocument();
  });

  it("should never show a negative balance in the other field, however much more than the balance is typed", async () => {
    const { container, getByRole } = render(Allocate, {
      ...baseProps,
      shieldedBalance: {
        spendable: 2_000_250_000_000n,
        value: 2_000_250_000_000n,
      },
      unshieldedBalance: 1_000_500_000_000n,
    });
    const publicInput = getByRole("textbox", { name: "Public amount" });
    const shieldedInput = getByRole("textbox", { name: "Shielded amount" });

    await fireEvent.input(shieldedInput, {
      target: { value: "99999999.123456789" },
    });

    expect(shieldedInput).toHaveValue("99999999.123456789");
    expect(publicInput).toHaveValue("0");
    expect(container.querySelector(".banner--error")).toHaveTextContent(
      /more than/i,
    );
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.input(publicInput, { target: { value: "3000.75" } });

    expect(publicInput).toHaveValue("3000.75");
    expect(shieldedInput).toHaveValue("0");
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    // Within the balance, what's left again.
    await fireEvent.input(publicInput, { target: { value: "1000.75" } });

    expect(shieldedInput).toHaveValue("2000");
    expect(getByRole("button", { name: "Review" })).toBeEnabled();
  });
});
