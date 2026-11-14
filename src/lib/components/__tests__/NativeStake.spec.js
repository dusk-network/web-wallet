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
  liquidHref: "/dashboard/stake?flow=liquid",
  minimumStake: 1_000n * DUSK,
  unstakeFee: 50_000_000n,
};

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
    expect(amountProblem("", "de")).toBe("");
    expect(amountProblem("10,5", "de")).toBe("");
    // Lena's: neither number in the question reads as the other, as
    // "1.000" for one reads as a thousand in German.
    expect(amountProblem("1.000", "de")).toBe(
      "Is that 1 or 1000? Write the one you mean."
    );
    expect(amountProblem("1,000", "en")).toBe(
      "Is that 1 or 1000? Write the one you mean."
    );
    expect(amountProblem("0,1234567891", "de")).toBe(
      "DUSK has 9 decimals at most."
    );
    expect(amountProblem("ten", "de")).toBe(
      "Enter an amount such as 10 or 10,5."
    );
    expect(amountProblem("ten", "en", "1000")).toBe(
      "Enter an amount such as 1000 or 1000.5."
    );
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
    expect(check("ten").error).toBe("Enter an amount such as 1000 or 1000.5.");
    expect(check("0").error).toBe("Enter an amount greater than 0.");
    expect(check("999")).toStrictEqual({
      error: "The minimum stake is 1,000 DUSK.",
      isMinimum: true,
      ok: false,
    });
    expect(check("1483").error).toBe(
      "That's 0.05 DUSK more than the public balance, with the network fee."
    );
    expect(check("1482.95")).toStrictEqual({
      error: "",
      isMinimum: false,
      ok: true,
    });
  });

  it("keeps what a stake must leave for its way out, and says so", () => {
    const keep = 50_000_000n;

    expect(check("1482.95", { keep }).error).toBe(
      "That's 0.05 DUSK more than the public balance, with this fee and the fee to unstake later."
    );
    expect(check("1482.95", { hidden: true, keep }).error).toBe(
      "That leaves too little for this fee and the fee to unstake later."
    );
    expect(check("1482.9", { keep }).ok).toBe(true);
  });

  it("doesn't let an amount give away the balance while balances are hidden", () => {
    expect(check("1483", { hidden: true }).error).toBe(
      "That leaves too little for the network fee."
    );
    expect(check("1484", { hidden: true }).error).toBe("More than you have.");
  });

  it("caps an amount on its own, and then only the fee is paid from the balance", () => {
    const most = { amount: 5n * DUSK, error: "That's more than you have." };

    expect(check("6", { minimum: 0n, most }).error).toBe(
      "That's more than you have."
    );
    expect(check("ten", { minimum: 0n, most }).error).toBe(
      "Enter an amount such as 10 or 10.5."
    );
    expect(check("5", { available: 0n, minimum: 0n, most }).error).toBe(
      "The network fee is paid from the public balance, and it's empty: 0.05 DUSK short. Add that much to it first."
    );
    expect(
      check("5", { available: 49_000_000n, minimum: 0n, most }).error
    ).toBe(
      "The public balance doesn't cover the network fee: 0.001 DUSK short. Add that much to it first."
    );
    // Lowering it is offered only where it can get that low.
    expect(
      check("5", {
        available: 49_000_000n,
        leastFee: 49_000_001n,
        minimum: 0n,
        most,
      }).error
    ).toBe(
      "The public balance doesn't cover the network fee: 0.001 DUSK short. Add that much to it first."
    );
    expect(
      check("5", {
        available: 49_000_000n,
        leastFee: 49_000_000n,
        minimum: 0n,
        most,
      }).error
    ).toBe(
      "The public balance doesn't cover the network fee: 0.001 DUSK short. Add that much to it first, or lower the fee."
    );
    expect(
      check("5", { available: 49_000_000n, hidden: true, minimum: 0n, most })
        .error
    ).toBe(
      "The public balance doesn't cover the network fee: •••• DUSK short."
    );
    expect(check("5", { minimum: 0n, most }).ok).toBe(true);
  });

  it("gives an example in the language's way, and says an unstake's least as one", () => {
    expect(check("ten", { locale: "nl-NL" }).error).toBe(
      "Enter an amount such as 1000 or 1000,5."
    );
    expect(check("0.5", { action: "unstake", minimum: 4n }).error).toBe("");
    expect(check("0.000000001", { action: "unstake", minimum: 4n }).error).toBe(
      "The minimum unstake is 0.000000004 DUSK."
    );
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
      const { container, getByLabelText } = render(NativeStake, baseProps);

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "1500" },
      });

      expect(
        container.querySelector(".native-stake__error")?.textContent?.trim()
      ).toBe("More than you have.");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("hides what Max fills in while balances are hidden, not the minimum it can fill in", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText, getByRole } = render(
        NativeStake,
        baseProps
      );

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(getByLabelText("Stake amount")).toHaveValue("••••");
      expect(container.textContent).not.toContain("1,482.9");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: "Stake •••• DUSK" })).toBeEnabled();

      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.click(getByRole("button", { name: "Use 1,000" }));

      expect(getByLabelText("Stake amount")).toHaveValue("1000");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: "Stake 1,000 DUSK" })).toBeEnabled();
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("states what native staking takes, the lock and the burn in plain words, with no consensus key nor recovery phrase", () => {
    const { container, getByRole } = render(NativeStake, baseProps);
    const facts = Array.from(
      container.querySelectorAll(".native-stake__facts li"),
      (li) => li.textContent?.replace(/\s+/g, " ").trim()
    );

    expect(container).not.toHaveTextContent(/recovery phrase/i);
    expect(facts).toStrictEqual([
      "Needs your own Dusk node Run a node",
      "Rewards start in about 6 to 12 hours Unstake any time, with no waiting period.",
      "If your node misses its turn Part of your stake gets locked. It's still yours, and unstaking returns it. If the node breaks the rules, part of the stake can be burned (lost).",
    ]);
    // The docs on running one.
    expect(getByRole("link", { name: "Run a node" })).toHaveAttribute(
      "href",
      "https://docs.dusk.network/operator/provisioner/"
    );
  });

  it("stakes the amount typed, with the gas shown, and shows the result", async () => {
    const { container, findByText, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1200.5" },
    });

    expect(
      Array.from(container.querySelectorAll(".stake-flow__rows > div"), (row) =>
        row.textContent?.replace(/\s+/g, " ").trim()
      )
    ).toStrictEqual([
      "Stake 1,200.5 DUSK",
      "Rewards start In about 6 to 12 hours",
      "Paid from Public balance",
      "Total Up to 1,200.55 DUSK",
    ]);

    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Stake 1,200.5 DUSK" }));

    expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
      1_200_500_000_000n,
      1n,
      50_000_000n
    );
    expect(getByRole("link", { name: "Back to staking" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/stake"
    );
    expect(await findByText("1,200.5 DUSK to your stake")).toBeInTheDocument();
  });

  it("shows the amount typed in the summary, muted, while it can't be staked", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    const [stake] = container.querySelectorAll(".stake-flow__rows dd");
    const total = container.querySelector(".stake-flow__rows--total dd");

    expect(stake).toHaveTextContent("100 DUSK");
    expect(stake).toHaveClass("stake-flow__muted");
    expect(total).toHaveTextContent("Up to 100.05 DUSK");
    expect(total).toHaveClass("stake-flow__muted");
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1000" },
    });

    expect(stake).toHaveTextContent("1,000 DUSK");
    expect(stake).not.toHaveClass("stake-flow__muted");
    expect(total).not.toHaveClass("stake-flow__muted");
  });

  it("takes an amount with a decimal comma, as Send does", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1000,5" },
    });

    expect(container.querySelector(".stake-flow__rows dd")).toHaveTextContent(
      "1,000.5 DUSK"
    );

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: "Stake 1,000.5 DUSK" })).toBeEnabled();
  });

  it("asks which amount is meant of one that could be either of two, as Send does, with a button for each", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1,000" },
    });

    expect(getByRole("alert")).toHaveTextContent(/^Is that 1 or 1000\?/);

    await fireEvent.click(getByRole("button", { name: "1000 DUSK" }));

    expect(getByLabelText("Stake amount")).toHaveValue("1000");
    expect(getByRole("button", { name: "Review" })).toBeEnabled();
  });

  it("adds to a stake there is: no minimum, and the lock on what is added", async () => {
    const { container, getByLabelText, getByRole, queryByRole } = render(
      NativeStake,
      { ...baseProps, hasStake: true }
    );

    expect(getByRole("heading", { name: "Stake more" })).toBeInTheDocument();
    expect(queryByRole("button", { name: "Use 1,000" })).toBeNull();
    expect(container.querySelector(".native-stake__facts")).toHaveTextContent(
      "10% of what you add is locked When your stake is already active. It's still yours, and unstaking returns it."
    );

    await fireEvent.input(getByLabelText("Amount to add"), {
      target: { value: "10" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Stake 10 DUSK" }));

    expect(baseProps.execute).toHaveBeenCalledWith(10n * DUSK, 1n, 50_000_000n);
  });

  it("fills in all of the public balance but this fee and the fee to unstake later with Max", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );

    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(getByLabelText("Stake amount")).toHaveValue("1482.9");
    expect(container).toHaveTextContent(
      "Max keeps 0.1 DUSK: up to 0.05 for this fee and 0.05 to unstake later."
    );
    expect(getByRole("button", { name: "Max" })).toHaveAttribute(
      "title",
      "All of it, less the network fee and the fee to unstake later"
    );

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: "Stake 1,482.9 DUSK" })).toBeEnabled();
  });

  it("refuses an amount typed that leaves too little to unstake, as Max would", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );

    // All but this stake's own fee: the most it took before.
    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1482.95" },
    });

    expect(container.querySelector(".native-stake__error")).toHaveTextContent(
      "That's 0.05 DUSK more than the public balance, with this fee and the fee to unstake later."
    );
    expect(getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("offers the minimum only with enough left to unstake it, and says why not", () => {
    const { container, getByRole, queryByRole } = render(NativeStake, {
      ...baseProps,
      availableBalance: 1_000n * DUSK + 50_000_000n,
    });

    // It would cover the minimum and this stake's fee, with nothing left.
    expect(queryByRole("button", { name: "Use 1,000" })).toBeNull();
    expect(getByRole("button", { name: "Max" })).toBeEnabled();
    expect(container.querySelector(".native-stake__note")).toHaveTextContent(
      "Your public balance doesn't cover the 1,000 DUSK minimum, this fee and the fee to unstake later."
    );
  });

  it("reviews the summary on its own before anything goes, and goes back", async () => {
    const { container, getByLabelText, getByRole, queryByRole } = render(
      NativeStake,
      baseProps
    );
    const review = getByRole("button", { name: "Review" });

    expect(review).toBeDisabled();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1000" },
    });
    await afterConfirmDelay();

    // One button beside the form, and it doesn't stake.
    expect(queryByRole("button", { name: /^Stake/ })).toBeNull();

    await fireEvent.click(review);

    expect(baseProps.execute).not.toHaveBeenCalled();
    expect(container.querySelector(".stake-flow")).toHaveClass(
      "stake-flow--review"
    );
    expect(queryByRole("button", { name: "Review" })).toBeNull();
    expect(getByRole("heading", { name: /Review/ })).toHaveFocus();

    await fireEvent.click(getByRole("button", { name: "Back" }));

    expect(container.querySelector(".stake-flow")).not.toHaveClass(
      "stake-flow--review"
    );
    expect(getByLabelText("Stake amount")).toHaveValue("1000");
  });

  it("follows the browser's Back and Forward between the filled form and its review", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );
    const isReview = () =>
      container
        .querySelector(".stake-flow")
        ?.classList.contains("stake-flow--review");

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1000" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(isReview()).toBe(true);

    // The history at the form again, as Back leaves it.
    historyAt({});
    await tick();

    expect(isReview()).toBe(false);
    expect(getByLabelText("Stake amount")).toHaveValue("1000");

    // And at the review, as Forward does.
    historyAt({ stakeReview: true });
    await tick();

    expect(isReview()).toBe(true);

    historyAt({});
  });

  it("stays on the form when the history is at a review of a form it no longer has", async () => {
    historyAt({ stakeReview: true });

    const { container } = render(NativeStake, baseProps);

    expect(container.querySelector(".stake-flow")).not.toHaveClass(
      "stake-flow--review"
    );

    historyAt({});
  });

  it("takes no click on Stake for half a second once the review shows, so a double click on Review can't stake", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);
    const stake = () => getByRole("button", { name: "Stake 1,000 DUSK" });

    await fireEvent.input(getByLabelText("Stake amount"), {
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
      50_000_000n
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

      await fireEvent.input(view.getByLabelText("Stake amount"), {
        target: { value: "1000" },
      });
      await fireEvent.click(view.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        view.getByRole("button", { name: "Stake 1,000 DUSK" })
      );
      await view.findByText(/^(Transaction failed|Not sent|Not confirmed)$/);

      return { ...view, execute };
    };

    afterEach(() => {
      historyAt({});
    });

    it("goes back to the review with Try again, the amount kept, when nothing went out", async () => {
      const { container, execute, findByText, getByLabelText, getByRole } =
        await staked(new TypeError("Failed to fetch"));

      expect(
        getByRole("link", { name: "Back to staking" })
      ).toBeInTheDocument();

      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(container.querySelector(".stake-flow")).toHaveClass(
        "stake-flow--review"
      );
      expect(getByLabelText("Stake amount")).toHaveValue("1000");
      expect(execute).toHaveBeenCalledOnce();

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Stake 1,000 DUSK" }));

      expect(execute).toHaveBeenCalledTimes(2);
      expect(await findByText("1,000 DUSK to your stake")).toBeInTheDocument();
    });

    it("goes back to the form with Back in the browser, when nothing went out", async () => {
      historyAt({ stakeReview: true });

      const { container, getByLabelText } = await staked(
        new TypeError("Failed to fetch")
      );

      historyAt({});
      await tick();

      expect(container.querySelector(".stake-flow")).not.toHaveClass(
        "stake-flow--review"
      );
      expect(getByLabelText("Stake amount")).toHaveValue("1000");
    });

    it("offers no Try again when it may have gone out", async () => {
      const { container, execute, getByRole, queryByRole } = await staked(
        outcomeUnknown(new TypeError("Failed to fetch"))
      );

      expect(queryByRole("button", { name: "Try again" })).toBeNull();
      expect(getByRole("link", { name: "Open History" })).toBeInTheDocument();

      historyAt({});
      await tick();

      expect(container.querySelector(".stake-flow")).toBeNull();
      expect(execute).toHaveBeenCalledOnce();
    });
  });

  it("keeps the gas a review shows when the node's price changes, and takes it after", async () => {
    const { container, getByLabelText, getByRole, rerender } = render(
      NativeStake,
      { ...baseProps, execute: vi.fn().mockResolvedValue(HASH) }
    );
    const total = () =>
      Array.from(container.querySelectorAll(".stake-flow__rows > div"), (row) =>
        row.textContent?.replace(/\s+/g, " ").trim()
      ).find((text) => text?.startsWith("Total"));

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1000" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await rerender({ gasSettings: { gasLimit: 50_000_000n, gasPrice: 3n } });

    expect(total()).toBe("Total Up to 1,000.05 DUSK");

    await fireEvent.click(getByRole("button", { name: "Back" }));

    expect(total()).toBe("Total Up to 1,000.15 DUSK");
  });
});
