import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { page } from "$app/stores";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";

import { settingsStore } from "$lib/stores";
import { outcomeUnknown } from "$lib/transactions";

import { NativeStake } from "..";
import {
  amountProblem,
  checkAmount,
  readDuskInput,
} from "../Stake/stakeAmount";

// The transaction sent stays pending.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

// The page's history state, as the tests move it.
vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  return { page: writable({ state: {} }) };
});

const historyAt = (/** @type {{ stakeReview?: boolean }} */ state) =>
  /** @type {import("svelte/store").Writable<any>} */ (
    /** @type {unknown} */ (page)
  ).set({ state });

const HASH = "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
const DUSK = 1_000_000_000n;

const baseProps = {
  availableBalance: 1_483n * DUSK,
  execute: vi.fn().mockResolvedValue(HASH),
  gasLimits: {
    gasLimitLower: 35_000_000n,
    gasLimitUpper: 1_000_000_000n,
    gasPriceLower: 1n,
  },
  gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
  liquidHref: /** @type {const} */ ("/dashboard/stake/?flow=liquid"),
  minimumStake: 1_000n * DUSK,
  unstakeFee: 50_000_000n,
};

/**
 * Matches a name or a text that shows `amount` DUSK, whatever its words.
 *
 * @param {string} amount As the page writes it, as "1,000.5"
 * @returns {(text: string) => boolean}
 */
const showsDusk = (amount) => (text) => ` ${text}`.includes(` ${amount} DUSK`);

/**
 * Matches `value` whole: not inside a longer figure, nor signed, so "1 DUSK"
 * matches neither "11 DUSK", "0.1 DUSK" nor a signed "1 DUSK".
 *
 * @param {string} value As the page writes it, as "1,000.5 DUSK"
 */
const wholeFigure = (value) =>
  new RegExp(`(?<![^ ])${value.replaceAll(".", "[.]")}(?![.,]?[0-9])`);

/**
 * The value of a row of the summary, found by its label's key word.
 *
 * @param {HTMLElement} container
 * @param {RegExp} label
 */
const rowOf = (container, label) =>
  Array.from(container.querySelectorAll(".stake-flow__rows > div"))
    .find((row) => label.test(row.querySelector("dt")?.textContent ?? ""))
    ?.querySelector("dd") ?? null;

/**
 * The summary's total: the most a stake costs.
 *
 * @param {HTMLElement} container
 */
const totalOf = (container) =>
  container.querySelector(".stake-flow__rows--total dd");

/** What a send that failed came to, as its heading says it. */
const failureOf = () => document.querySelector(".dusk-error-alert__summary");

/** What a send on its way says it is. */
const goingOf = () => document.querySelector(".transaction-status__what");

describe("readDuskInput", () => {
  it("reads DUSK as lux, with up to nine decimals and nothing else", () => {
    expect(readDuskInput("1000", "en")).toBe(1_000n * DUSK);
    expect(readDuskInput(" 1000.5 ", "en")).toBe(1_000_500_000_000n);
    expect(readDuskInput(".000000001", "en")).toBe(1n);
    expect(readDuskInput("12.", "en")).toBe(12n * DUSK);

    for (const text of ["", "1,000", "1e3", "-1", "1.0000000001", "abc"]) {
      expect(readDuskInput(text, "en")).toBeNull();
    }
  });

  it("reads a decimal comma as a point, and leaves digit grouping out where it can't be decimals", () => {
    expect(readDuskInput("1,5", "en")).toBe(1_500_000_000n);
    expect(readDuskInput(" 0,25 ", "en")).toBe(250_000_000n);
    expect(readDuskInput("0,123", "en")).toBe(123_000_000n);
    expect(readDuskInput("1.000,5", "en")).toBe(1_000_500_000_000n);
    expect(readDuskInput("1,000.5", "en")).toBe(1_000_500_000_000n);
    expect(readDuskInput("1,000,000", "en")).toBe(1_000_000n * DUSK);

    // A lone comma or point before three digits, after a whole part that
    // isn't 0, could mean a thousand as well as one, in any language: it's
    // refused, to be asked about.
    expect(readDuskInput("1,000", "de")).toBeNull();
    expect(readDuskInput("0,100", "en")).toBe(100_000_000n);
    expect(readDuskInput("1.000", "de")).toBeNull();
    expect(readDuskInput("12.500", "de")).toBeNull();
    expect(readDuskInput("1.5", "de")).toBe(1_500_000_000n);
    expect(readDuskInput("0.100", "de")).toBe(100_000_000n);
    expect(readDuskInput("1.000", "en")).toBeNull();

    for (const text of ["1,00,0", "1e3", "1.2.3", "abc", "1,5,"]) {
      expect(readDuskInput(text, "en")).toBeNull();
    }
  });

  it("reads the language's own groups, as it writes them", () => {
    for (const space of [" ", "\u00a0", "\u202f"]) {
      expect(readDuskInput(`1${space}000`, "fr-FR")).toBe(1_000n * DUSK);
      expect(readDuskInput(`1${space}000,5`, "fr-FR")).toBe(1_000_500_000_000n);
    }

    expect(readDuskInput("1'000.5", "de-CH")).toBe(1_000_500_000_000n);
    // Not English's.
    expect(readDuskInput("1 000", "en")).toBeNull();
  });
});

describe("amountProblem", () => {
  it("says why an amount can't be read, in the language's own writing", () => {
    /** @param {string} text */
    const numbers = (text) => text.match(/[0-9]+/g);

    expect(amountProblem("", "de")).toBe("");
    expect(amountProblem("10,5", "de")).toBe("");
    // Lena's: neither number in the question reads as the other, as
    // "1.000" for one reads as a thousand in German.
    expect(numbers(amountProblem("1.000", "de"))).toStrictEqual(["1", "1000"]);
    expect(numbers(amountProblem("1,000", "en"))).toStrictEqual(["1", "1000"]);
    // More decimals than DUSK's nine.
    expect(amountProblem("0,1234567891", "de")).toMatch(
      wholeFigure("9 decimals"),
    );
    // Not an amount: an example, written as the language writes one.
    expect(amountProblem("ten", "de")).toMatch(wholeFigure("10,5"));
    expect(amountProblem("ten", "en", "1000")).toMatch(wholeFigure("1000.5"));
  });
});

describe("checkAmount", () => {
  const base = {
    available: 1_483n * DUSK,
    fee: 50_000_000n,
    locale: "en",
    minimum: 1_000n * DUSK,
  };

  /** @param {string} text */
  const check = (text, extra = {}) =>
    checkAmount({
      ...base,
      amount: readDuskInput(text, "en"),
      text,
      ...extra,
    });

  it("says what is wrong with an amount, in the words the page shows", () => {
    expect(check("")).toStrictEqual({ error: "", isMinimum: false, ok: false });
    // Not an amount: an example of one, for the 1,000 DUSK minimum.
    expect(check("ten")).toMatchObject({
      error: expect.stringMatching(wholeFigure("1000.5")),
      ok: false,
    });
    expect(check("0")).toMatchObject({
      error: expect.stringMatching(/more than 0(?![.,]?[0-9])/),
      ok: false,
    });
    expect(check("999")).toStrictEqual({
      error: expect.stringMatching(wholeFigure("1,000 DUSK")),
      isMinimum: true,
      ok: false,
    });
    expect(check("1483")).toMatchObject({
      error: expect.stringMatching(wholeFigure("0.05 DUSK")),
      ok: false,
    });
    expect(check("1482.95")).toStrictEqual({
      error: "",
      isMinimum: false,
      ok: true,
    });
  });

  it("keeps what a stake must leave for its way out, and says so", () => {
    const keep = 50_000_000n;
    const hidden = check("1482.95", { hidden: true, keep });

    expect(check("1482.95", { keep })).toMatchObject({
      error: expect.stringMatching(wholeFigure("0.05 DUSK")),
      ok: false,
    });
    // Refused all the same with balances hidden, with no figure.
    expect(hidden).toMatchObject({
      error: expect.stringMatching(/too little/i),
      ok: false,
    });
    expect(hidden.error).not.toMatch(/[0-9]/);
    expect(check("1482.9", { keep }).ok).toBe(true);
  });

  it("doesn't let an amount give away the balance while balances are hidden", () => {
    // Shown, each says how much more than the balance it is; hidden, why
    // it's refused, with no figure.
    for (const { more, text, why } of [
      { more: "0.05 DUSK", text: "1483", why: /too little/i },
      { more: "1.05 DUSK", text: "1484", why: /more than/i },
    ]) {
      const hidden = check(text, { hidden: true });

      expect(check(text).error).toMatch(wholeFigure(more));
      expect(hidden).toMatchObject({
        error: expect.stringMatching(why),
        ok: false,
      });
      expect(hidden.error).not.toMatch(/[0-9]/);
    }
  });

  it("caps an amount on its own, and then only the fee is paid from the balance", () => {
    const most = { amount: 5n * DUSK, error: "That's more than you have." };
    const short = { available: 49_000_000n, minimum: 0n, most };

    expect(check("6", { minimum: 0n, most }).error).toBe(most.error);
    // Not an amount: an example of one.
    expect(check("ten", { minimum: 0n, most })).toMatchObject({
      error: expect.stringMatching(wholeFigure("10.5")),
      ok: false,
    });
    expect(check("5", { available: 0n, minimum: 0n, most })).toMatchObject({
      error: expect.stringMatching(wholeFigure("0.05 DUSK")),
      ok: false,
    });
    // However low the fee can go.
    for (const leastFee of [undefined, 49_000_001n, 49_000_000n]) {
      expect(check("5", { ...short, leastFee })).toMatchObject({
        error: expect.stringMatching(wholeFigure("0.001 DUSK")),
        ok: false,
      });
    }

    const hidden = check("5", { ...short, hidden: true });

    expect(hidden.ok).toBe(false);
    expect(hidden.error).not.toMatch(/[0-9]/);
    expect(check("5", { minimum: 0n, most }).ok).toBe(true);
  });

  it("says an unstake's least as one", () => {
    expect(check("0.5", { action: "unstake", minimum: 4n }).error).toBe("");
    expect(
      check("0.000000001", { action: "unstake", minimum: 4n }),
    ).toStrictEqual({
      error: expect.stringMatching(wholeFigure("0.000000004 DUSK")),
      isMinimum: true,
      ok: false,
    });
  });
});

describe("NativeStake", () => {
  // Stake takes a click half a second after it shows: on this clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });

  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    vi.useRealTimers();
  });

  it("doesn't say by how much a stake is over the balance while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { getByLabelText, getByRole } = render(NativeStake, baseProps);

      await fireEvent.input(getByLabelText("Amount"), {
        target: { value: "1500" },
      });

      // Refused, with no figure: shown, it would say 17.1 DUSK more than
      // the balance.
      expect(getByRole("alert")).toHaveTextContent(/more than/i);
      expect(getByRole("alert")).not.toHaveTextContent(/[0-9]/);
      expect(getByRole("button", { name: "Review" })).toBeDisabled();
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("hides what Max fills in while balances are hidden, not the minimum it can fill in", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText, getByRole } = render(
        NativeStake,
        baseProps,
      );

      /**
       * The figures shown anywhere on the form that give away what Max filled
       * in, 1,482.9, or the 1,483 balance it's from: exact, grouped or not, or
       * rounded, as 1,482 or 1,483. Each figure is read both ways it can be
       * meant: its last mark a decimal point, or every mark a grouping.
       */
      const giveAways = () =>
        (
          container.textContent?.match(/[0-9](?:[0-9.,']|\s(?=[0-9]))*/g) ?? []
        ).filter((figure) => {
          const digits = figure.replace(/[^0-9.,]/g, "");
          const mark = Math.max(
            digits.lastIndexOf("."),
            digits.lastIndexOf(","),
          );
          const read = [Number(digits.replace(/[.,]/g, ""))];

          if (mark >= 0) {
            read.push(
              Number(
                `${digits.slice(0, mark).replace(/[.,]/g, "")}.${digits.slice(mark + 1)}`,
              ),
            );
          }

          return read.some(
            (value) =>
              Math.abs(value - 1482.9) < 1 || Math.abs(value - 1483) < 1,
          );
        });

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // 1,482.9, filled in, with no figure in the field.
      const field = /** @type {HTMLInputElement} */ (getByLabelText("Amount"));

      expect(field.value).not.toBe("");
      expect(field.value).not.toMatch(/[0-9]/);
      expect(giveAways()).toStrictEqual([]);

      await fireEvent.click(getByRole("button", { name: "Review" }));

      const stake = getByRole("button", { name: /DUSK/ });

      expect(stake).toBeEnabled();
      expect(stake).not.toHaveAccessibleName(/[0-9]/);
      expect(giveAways()).toStrictEqual([]);

      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.click(getByRole("button", { name: /1,000/ }));

      expect(getByLabelText("Amount")).toHaveValue("1000");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: showsDusk("1,000") })).toBeEnabled();
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("stakes the amount typed, with the gas shown, and shows the result", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps,
    );

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1200.5" },
    });

    // The amount, and the most it costs with the gas shown, each in its row.
    expect(rowOf(container, /stake/i)).toHaveTextContent(
      wholeFigure("1,200.5 DUSK"),
    );
    expect(totalOf(container)).toHaveTextContent(wholeFigure("1,200.55 DUSK"));

    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("1,200.5") }));

    expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
      1_200_500_000_000n,
      1n,
      50_000_000n,
    );
    // On its way, with its amount.
    await vi.waitFor(() =>
      expect(
        document.querySelector(".transaction-status--pending"),
      ).not.toBeNull(),
    );
    expect(goingOf()).toHaveTextContent(wholeFigure("1,200.5 DUSK"));
  });

  it("takes an amount with a decimal comma, as Send does", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps,
    );

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1000,5" },
    });

    expect(rowOf(container, /stake/i)).toHaveTextContent(
      wholeFigure("1,000.5 DUSK"),
    );

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: showsDusk("1,000.5") })).toBeEnabled();
  });

  it("asks which amount is meant of one that could be either of two, as Send does, with a button for each", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1,000" },
    });

    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByRole("button", { name: "1 DUSK" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.click(getByRole("button", { name: "1000 DUSK" }));

    expect(getByLabelText("Amount")).toHaveValue("1000");
    expect(getByRole("button", { name: "Review" })).toBeEnabled();
  });

  it("adds to a stake there is, with no minimum", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, {
      ...baseProps,
      hasStake: true,
    });

    await fireEvent.input(getByLabelText("Amount to add"), {
      target: { value: "10" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("10") }));

    expect(baseProps.execute).toHaveBeenCalledWith(10n * DUSK, 1n, 50_000_000n);
  });

  it("fills in all of the public balance but this fee and the fee to unstake later with Max", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);

    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(getByLabelText("Amount")).toHaveValue("1482.9");

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: showsDusk("1,482.9") })).toBeEnabled();
  });

  it("refuses an amount typed that leaves too little to unstake, as Max would", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);

    // All but this stake's own fee: the most it took before.
    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1482.95" },
    });

    expect(getByRole("alert")).toHaveTextContent(wholeFigure("0.05 DUSK"));
    expect(getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("reviews the summary on its own before anything goes", async () => {
    const { getByLabelText, getByRole, queryByRole } = render(
      NativeStake,
      baseProps,
    );
    const review = getByRole("button", { name: "Review" });

    expect(review).toBeDisabled();

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1000" },
    });
    await afterConfirmDelay();

    // One button beside the form, and it doesn't stake.
    expect(queryByRole("button", { name: showsDusk("1,000") })).toBeNull();

    await fireEvent.click(review);

    expect(baseProps.execute).not.toHaveBeenCalled();
    expect(
      getByRole("button", { name: showsDusk("1,000") }),
    ).toBeInTheDocument();
  });

  it("takes no click on Stake for half a second once the review shows, so a double click on Review can't stake", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);
    const stake = () => getByRole("button", { name: showsDusk("1,000") });

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1000" },
    });
    await afterConfirmDelay();

    // Review's second tap lands where Stake now is, and so does Enter.
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await fireEvent.click(stake());
    await fireEvent.click(stake(), { detail: 0 });
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
    await fireEvent.click(stake());

    expect(baseProps.execute).not.toHaveBeenCalled();
    expect(stake()).toBeEnabled();

    await vi.advanceTimersByTimeAsync(1);
    await fireEvent.click(stake());

    expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
      1_000n * DUSK,
      1n,
      50_000_000n,
    );
  });

  describe("once it failed", () => {
    /** @param {Error} failure */
    const staked = async (failure) => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(HASH);
      const view = render(NativeStake, { ...baseProps, execute });

      await fireEvent.input(view.getByLabelText("Amount"), {
        target: { value: "1000" },
      });
      await fireEvent.click(view.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        view.getByRole("button", { name: showsDusk("1,000") }),
      );

      return { ...view, execute };
    };

    afterEach(() => {
      historyAt({});
    });

    it("goes back to the review with Try again, the amount kept, when nothing went out", async () => {
      const { execute, findByRole, getByLabelText, getByRole } = await staked(
        new TypeError("Failed to fetch"),
      );
      const tryAgain = await findByRole("button", { name: "Try again" });

      // Nothing went out.
      expect(failureOf()).toHaveTextContent(/not sent/i);

      await fireEvent.click(tryAgain);

      expect(
        getByRole("button", { name: showsDusk("1,000") }),
      ).toBeInTheDocument();
      expect(getByLabelText("Amount")).toHaveValue("1000");
      expect(execute).toHaveBeenCalledOnce();

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("1,000") }));

      expect(execute).toHaveBeenCalledTimes(2);
      // On its way, with its amount.
      await vi.waitFor(() =>
        expect(
          document.querySelector(".transaction-status--pending"),
        ).not.toBeNull(),
      );
      expect(goingOf()).toHaveTextContent(wholeFigure("1,000 DUSK"));
    });

    it("offers no Try again when it may have gone out", async () => {
      const { container, execute, findByRole, queryByRole } = await staked(
        outcomeUnknown(new TypeError("Failed to fetch")),
      );

      expect(
        await findByRole("link", { name: "Open Activity" }),
      ).toBeInTheDocument();
      expect(failureOf()).toHaveTextContent(/not confirmed/i);
      expect(queryByRole("button", { name: "Try again" })).toBeNull();

      historyAt({});
      await tick();

      expect(container.querySelector(".stake-flow")).toBeNull();
      expect(execute).toHaveBeenCalledOnce();
    });
  });

  it("keeps the gas a review shows when the node's price changes, and takes it after", async () => {
    const { container, getByLabelText, getByRole, rerender } = render(
      NativeStake,
      { ...baseProps, execute: vi.fn().mockResolvedValue(HASH) },
    );
    const total = () => totalOf(container);

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "1000" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await rerender({ gasSettings: { gasLimit: 50_000_000n, gasPrice: 3n } });

    expect(total()).toHaveTextContent(wholeFigure("1,000.05 DUSK"));

    await fireEvent.click(getByRole("button", { name: "Back" }));

    expect(total()).toHaveTextContent(wholeFigure("1,000.15 DUSK"));
  });
});
