import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";

import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import { settingsStore } from "$lib/stores";
import { outcomeUnknown } from "$lib/transactions";

import { LiquidStake } from "..";

const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

// The history of the profile, as the facts the export reads come from it.
const activity = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  sozuFacts:
    /** @type {import("vitest").Mock<(rows: any[]) => Promise<Map<string, any>>>} */ (
      vi.fn(async () => new Map())
    ),
}));

vi.mock("$lib/activity", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  currentActivity: () => activity,
}));

const HASH = "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
const DUSK = 1_000_000_000n;

/** Sozu's fees on mainnet, as its substrate gave them on 27 Oct 2026. */
const FEES = {
  deposit: { denominator: 400n, numerator: 1n },
  reward: { denominator: 100n, numerator: 15n },
};

/** Sozu's switches as read: deposits open, the pool not synchronizing. */
const OPEN = { maintenance: false, synchronization: false };

/**
 * @param {Partial<SozuStatus["position"]>} position
 * @param {SozuFees | null} [fees]
 * @param {SozuFlags} [flags]
 * @param {string} [pool]
 * @returns {SozuStatus}
 */
const statusWith = (position = {}, fees = FEES, flags = OPEN, pool = POOL) => ({
  contracts: {
    hub: "aa".repeat(32),
    pool,
    stDusk: "dd".repeat(32),
    substrate: "cc".repeat(32),
  },
  error: "",
  fees,
  flags,
  pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
  position: { balance: 0n, stDusk: 0n, ...position },
  source: "hub",
});

/**
 * Each action's gas, as the staking page gives it: a stake 5,000,000 and a
 * warning under 2,500,000; an unstake 10,000,000 and a warning under 4,000,000.
 *
 * @param {bigint} [gasPrice]
 */
const gasAt = (gasPrice = 1n) => ({
  stake: {
    limits: {
      gasLimitLower: 2_500_000n,
      gasLimitUpper: 1_000_000_000n,
      gasPriceLower: 1n,
    },
    settings: { gasLimit: 5_000_000n, gasPrice },
  },
  unstake: {
    limits: {
      gasLimitLower: 4_000_000n,
      gasLimitUpper: 1_000_000_000n,
      gasPriceLower: 1n,
    },
    settings: { gasLimit: 10_000_000n, gasPrice },
  },
});

const baseProps = {
  availableBalance: 172n * DUSK,
  execute: vi.fn().mockResolvedValue(HASH),
  gas: gasAt(),
  onRetry: vi.fn(),
  // Sozu read again before a stake goes: as it was.
  recheck: vi.fn(async () => statusWith()),
  sozu: { error: null, loading: false, status: statusWith() },
};

/** @param {Element | null} element */
const textOf = (element) => element?.textContent?.replace(/\s+/g, " ").trim();

/**
 * Matches a name or a text that shows `amount` DUSK, whatever its words.
 *
 * @param {string} amount As the page writes it, as "0.985"
 * @returns {(text: string) => boolean}
 */
const showsDusk = (amount) => (text) => ` ${text}`.includes(` ${amount} DUSK`);

/**
 * What the summary beside the form shows, its values among its words.
 *
 * @param {HTMLElement} container
 */
const summaryOf = (container) =>
  textOf(container.querySelector(".stake-flow__summary")) ?? "";

describe("LiquidStake", () => {
  // Stake and Unstake take a click half a second after they show: on this
  // clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });

  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    baseProps.onRetry.mockClear();
    baseProps.recheck.mockClear();
    vi.useRealTimers();
  });

  it("stakes any amount with Sozu's pool, saying about what it gets", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps,
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    // For what's left once Sozu's 0.25% deposit fee is off it, and what
    // that's worth now.
    const estimate = container.querySelector(".liquid-stake__estimate");

    expect(estimate).toHaveTextContent("32.4378 stDUSK");
    expect(estimate).toHaveTextContent("99.75 DUSK");

    // The amount, what it gets, Sozu's deposit fee, and the most it costs.
    const summary = summaryOf(container);

    for (const value of [
      "100 DUSK",
      "32.4378 stDUSK",
      "0.25%",
      "0.25 DUSK",
      "100.005 DUSK",
    ]) {
      expect(summary).toContain(value);
    }

    // The pool it calls, by its ID, under the fee's Edit.
    await fireEvent.click(getByRole("button", { name: "Edit" }));

    expect(
      container.querySelector(".liquid-stake__contract"),
    ).toHaveTextContent("728839…3078f2");

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(baseProps.execute).not.toHaveBeenCalled();
    expect(baseProps.recheck).not.toHaveBeenCalled();

    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

    // A stake's own gas: 5,000,000 at the node's price, once Sozu's terms
    // are read again.
    await vi.waitFor(() =>
      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        "stake",
        POOL,
        100n * DUSK,
        1n,
        5_000_000n,
      ),
    );
    expect(baseProps.recheck).toHaveBeenCalledOnce();
  });

  describe("the review before anything goes", () => {
    /** @param {import("@testing-library/svelte").RenderResult<any>["getByLabelText"]} getByLabelText */
    const typed = (getByLabelText) =>
      fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });

    it("sends nothing on the first press: the one button beside the form is Review", async () => {
      const { getByLabelText, getByRole, queryByRole } = render(
        LiquidStake,
        baseProps,
      );

      await typed(getByLabelText);
      await afterConfirmDelay();

      expect(queryByRole("button", { name: showsDusk("100") })).toBeNull();

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(baseProps.recheck).not.toHaveBeenCalled();
      expect(
        getByRole("button", { name: showsDusk("100") }),
      ).toBeInTheDocument();
    });

    it("says on the review that the deposit fee doesn't come back, with its amount", async () => {
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        baseProps,
      );

      await typed(getByLabelText);

      expect(container.querySelector(".stake-flow__final")).toBeNull();

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(container.querySelector(".stake-flow__final")).toHaveTextContent(
        "0.25 DUSK",
      );
    });

    it("hides that amount with the balances, and says it without one where the fee couldn't be read", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const hidden = render(LiquidStake, baseProps);

        await typed(hidden.getByLabelText);
        await fireEvent.click(hidden.getByRole("button", { name: "Review" }));

        const final = hidden.container.querySelector(".stake-flow__final");

        expect(final).not.toBeNull();
        expect(final).not.toHaveTextContent("0.25 DUSK");
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }

      cleanup();

      const unread = render(LiquidStake, {
        ...baseProps,
        sozu: { error: null, loading: false, status: statusWith({}, null) },
      });

      await typed(unread.getByLabelText);
      await fireEvent.click(unread.getByRole("button", { name: "Review" }));

      // No figure for a fee it couldn't read.
      const final = unread.container.querySelector(".stake-flow__final");

      expect(final).not.toBeNull();
      expect(final).not.toHaveTextContent(/[0-9]/);
    });
  });

  describe("once it failed", () => {
    /** @param {Error} failure */
    const staked = async (failure) => {
      const execute = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(HASH);
      const view = render(LiquidStake, { ...baseProps, execute });

      await fireEvent.input(view.getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(view.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        view.getByRole("button", { name: showsDusk("100") }),
      );

      return { ...view, execute };
    };

    it("goes back to the review with Try again, the amount kept, and reads Sozu's terms again before it goes", async () => {
      const { execute, findByRole, getByLabelText, getByRole, getByText } =
        await staked(new TypeError("Failed to fetch"));
      const tryAgain = await findByRole("button", { name: "Try again" });

      expect(baseProps.recheck).toHaveBeenCalledOnce();

      await fireEvent.click(tryAgain);

      expect(
        getByRole("button", { name: showsDusk("100") }),
      ).toBeInTheDocument();
      expect(getByLabelText("Stake amount")).toHaveValue("100");
      expect(execute).toHaveBeenCalledOnce();

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
      expect(baseProps.recheck).toHaveBeenCalledTimes(2);
      // On its way, with its amount.
      await findByRole("status");
      expect(getByText(showsDusk("100"))).toBeInTheDocument();
    });

    it("offers no Try again when it may have gone out", async () => {
      const { execute, findByRole, queryByRole } = await staked(
        outcomeUnknown(new TypeError("Failed to fetch")),
      );

      expect(
        await findByRole("link", { name: "Open History" }),
      ).toBeInTheDocument();
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
      expect(execute).toHaveBeenCalledOnce();
    });
  });

  it("takes an amount with a decimal comma, as Send does, and Max in the language's way", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps,
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0,5" },
    });

    expect(container.querySelector(".stake-flow__rows dd")).toHaveTextContent(
      "0.5 DUSK",
    );

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: showsDusk("0.5") })).toBeEnabled();
  });

  it("hides the DUSK of Sozu's deposit fee with the balances, not its rate", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText } = render(LiquidStake, baseProps);

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "50" },
      });

      // Its 0.125 DUSK, not its 0.25% rate.
      const summary = summaryOf(container);

      expect(summary).not.toContain("0.125");
      expect(summary).toContain("0.25%");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("says what an unstake sends while it goes", async () => {
    const execute = vi.fn().mockResolvedValue("ab".repeat(32));
    const { findByRole, getByLabelText, getByRole, getByText } = render(
      LiquidStake,
      {
        ...baseProps,
        action: "unstake",
        execute,
        sozu: {
          ...baseProps.sozu,
          status: statusWith({ balance: 15n * DUSK, stDusk: 4n * DUSK }),
        },
      },
    );

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("1") }));

    await findByRole("status");
    expect(getByText(showsDusk("1"))).toBeInTheDocument();
  });

  it("says on the Sent screen the stDUSK a stake got, and the rate, once its block is final, from the facts the export reads", async () => {
    // Its block is final at once.
    followTransaction.mockResolvedValueOnce(
      /** @type {any} */ ({
        blockHeight: 4_700_123n,
        error: null,
        fee: 4_419_010n,
        timestamp: null,
      }),
    );
    activity.sozuFacts
      // The archive doesn't list it yet, then does.
      .mockResolvedValueOnce(new Map())
      .mockImplementationOnce(async (/** @type {any[]} */ [call]) => {
        expect(call).toMatchObject({
          blockHeight: 4_700_123,
          contractId: POOL,
          hash: HASH,
          sozu: "stake",
          value: 100n * DUSK,
        });

        return new Map([
          [
            HASH,
            {
              amount: 100n * DUSK,
              fee: DUSK / 4n,
              kind: "stake",
              pool: { stake: 3n * DUSK, supply: DUSK },
              stDusk: 33_250_000_000n,
            },
          ],
        ]);
      });
    // The button takes a click half a second after it shows, and the archive
    // is asked again a moment later: on this clock.
    vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });

    const { findByText, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps,
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

    // Final: the fee it was charged shows.
    expect(await findByText(showsDusk("0.00441901"))).toBeInTheDocument();

    const details = /** @type {HTMLElement} */ (
      document.querySelector(".transaction-status__details")
    );

    // Read again a moment later, once the archive lists it.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(details).toHaveTextContent("33.25 stDUSK");
    expect(details).toHaveTextContent("1 stDUSK = 3 DUSK");
    activity.sozuFacts.mockReset();
    activity.sozuFacts.mockResolvedValue(new Map());
  });

  it("says the stDUSK a stake got on its Sent screen also when the send's answer got lost, by the hash it went out with", async () => {
    // Handed over, with no answer: the hash it may have gone out with.
    baseProps.execute.mockRejectedValueOnce(
      outcomeUnknown(new TypeError("Failed to fetch"), HASH),
    );
    followTransaction.mockResolvedValueOnce(
      /** @type {any} */ ({
        blockHeight: 4_700_123n,
        error: null,
        fee: 4_419_010n,
        timestamp: null,
      }),
    );
    activity.sozuFacts.mockImplementationOnce(
      async (/** @type {any[]} */ [call]) =>
        new Map([
          [
            call.hash,
            {
              amount: 100n * DUSK,
              fee: DUSK / 4n,
              kind: "stake",
              pool: { stake: 3n * DUSK, supply: DUSK },
              stDusk: 33_250_000_000n,
            },
          ],
        ]),
    );
    vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });

    const { findByText, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps,
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

    // Final: the fee it was charged shows.
    expect(await findByText(showsDusk("0.00441901"))).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(0);

    expect(activity.sozuFacts).toHaveBeenCalledWith([
      expect.objectContaining({ hash: HASH }),
    ]);
    expect(
      document.querySelector(".transaction-status__details"),
    ).toHaveTextContent("33.25 stDUSK");
    activity.sozuFacts.mockReset();
    activity.sozuFacts.mockResolvedValue(new Map());
  });

  it("refuses an unstake too small to burn any stDUSK, saying the least, unless it's all there is", async () => {
    const unstakeOf = (/** @type {bigint} */ balance) =>
      render(LiquidStake, {
        ...baseProps,
        action: "unstake",
        sozu: {
          ...baseProps.sozu,
          status: statusWith({ balance, stDusk: balance / 3n || 1n }),
        },
      });
    const { getByLabelText, getByRole } = unstakeOf(15n * DUSK);

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "0.000000001" },
    });

    // At 3.0751 DUSK a stDUSK, 4 lux burns the least there is of it.
    expect(getByRole("alert")).toHaveTextContent("0.000000004 DUSK");
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "0.000000004" },
    });

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(
      getByRole("button", { name: showsDusk("0.000000004") }),
    ).toBeEnabled();
    cleanup();

    // All of a smaller stake burns all its stDUSK.
    const small = unstakeOf(3n);

    await fireEvent.input(small.getByLabelText("Unstake amount"), {
      target: { value: "0.000000003" },
    });

    await fireEvent.click(small.getByRole("button", { name: "Review" }));

    expect(
      small.getByRole("button", { name: showsDusk("0.000000003") }),
    ).toBeEnabled();
  });

  it("refuses a stake too small to get any stDUSK, saying the least", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, baseProps);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0.000000001" },
    });

    // 4 lux gets stDUSK at the rate, so 5 does once the fee is off it.
    expect(getByRole("alert")).toHaveTextContent("0.000000005 DUSK");
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0.000000005" },
    });

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(
      getByRole("button", { name: showsDusk("0.000000005") }),
    ).toBeEnabled();
  });

  it("says Sozu's deposit fee as the contract gives it, and none where it couldn't be read", async () => {
    const summaryFor = async (/** @type {SozuFees | null} */ fees) => {
      const { container, getByLabelText } = render(LiquidStake, {
        ...baseProps,
        sozu: { error: null, loading: false, status: statusWith({}, fees) },
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "1" },
      });

      const summary = summaryOf(container);

      cleanup();

      return summary;
    };

    // Of 1 DUSK.
    const read = await summaryFor(FEES);

    expect(read).toContain("0.25%");
    expect(read).toContain("0.0025 DUSK");

    const raised = await summaryFor({
      ...FEES,
      deposit: { denominator: 100n, numerator: 1n },
    });

    expect(raised).toContain("1%");
    expect(raised).toContain("0.01 DUSK");
    expect(await summaryFor(null)).not.toContain("%");
  });

  it("doesn't let an amount give away the balance while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { getByLabelText, getByRole } = render(LiquidStake, baseProps);
      const refusal = async (/** @type {string} */ value) => {
        await fireEvent.input(getByLabelText("Stake amount"), {
          target: { value },
        });

        expect(getByRole("button", { name: "Review" })).toBeDisabled();

        return getByRole("alert");
      };

      // Shown, these would say 0.015 and 827.015 DUSK more than the balance.
      expect(await refusal("172")).not.toHaveTextContent("0.015");
      expect(await refusal("999")).not.toHaveTextContent("827.015");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("hides what Max fills in while balances are hidden, and shows what's typed over it", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        baseProps,
      );

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // All but both fees, 171.985: filled in, not shown.
      expect(getByLabelText("Stake amount")).not.toHaveValue("");
      expect(textOf(container)).not.toContain("171.985");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: /DUSK/ })).toBeEnabled();
      expect(textOf(container)).not.toContain("171.985");
      for (const row of container.querySelectorAll(".stake-flow__rows dd")) {
        expect(textOf(row)).not.toMatch(/\d (st)?DUSK/);
      }

      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "5" },
      });

      expect(getByLabelText("Stake amount")).toHaveValue("5");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: showsDusk("5") })).toBeEnabled();
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("says when a stake is more than the public balance, with this fee and the fee to unstake later", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, baseProps);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "172" },
    });

    expect(getByRole("alert")).toHaveTextContent("0.015 DUSK");
    expect(getByRole("button", { name: "Review" })).toBeDisabled();
  });

  describe("what a stake leaves to get back out with", () => {
    const shown = { ...baseProps, availableBalance: DUSK };

    it("keeps this fee and the fee to unstake with Max, which then pays for that unstake", async () => {
      const { getByLabelText, getByRole } = render(LiquidStake, shown);

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // 1 DUSK, less 0.005 for this stake and 0.01 for the unstake.
      expect(getByLabelText("Stake amount")).toHaveValue("0.985");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: showsDusk("0.985") })).toBeEnabled();

      cleanup();

      // The stake's block leaves what was kept: the way out is open.
      const after = render(LiquidStake, {
        ...baseProps,
        action: "unstake",
        availableBalance: DUSK - 985_000_000n - 5_000_000n,
        sozu: {
          error: null,
          loading: false,
          status: statusWith({ balance: 970_000_000n, stDusk: 1n }),
        },
      });

      await fireEvent.click(after.getByRole("button", { name: "Max" }));
      await fireEvent.click(after.getByRole("button", { name: "Review" }));

      expect(
        after.getByRole("button", { name: showsDusk("0.97") }),
      ).toBeEnabled();
    });

    it("refuses an amount typed that leaves too little to unstake, as Max would", async () => {
      const { getByLabelText, getByRole } = render(LiquidStake, shown);

      // All but this stake's own fee: the most it took before.
      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "0.995" },
      });

      expect(getByRole("alert")).toHaveTextContent("0.01 DUSK");
      expect(getByRole("button", { name: "Review" })).toBeDisabled();
    });

    it("keeps Max off with too little for both fees", () => {
      const { getByRole } = render(LiquidStake, {
        ...baseProps,
        availableBalance: 15_000_000n,
      });

      expect(getByRole("button", { name: "Max" })).toBeDisabled();
    });

    /** What the wallet left Lena with, her 0.97 DUSK staked with Sozu. */
    const stranded = {
      ...baseProps,
      action: /** @type {const} */ ("unstake"),
      availableBalance: 2_863_982n,
      sozu: {
        error: null,
        loading: false,
        status: statusWith({ balance: 970_900_000n, stDusk: 1n }),
      },
    };

    it("says how much is missing to unstake as the tab opens, before anything is typed", async () => {
      const { getByLabelText, getByRole } = render(LiquidStake, stranded);

      expect(getByLabelText("Unstake amount")).toHaveValue("");
      expect(getByRole("alert")).toHaveTextContent("0.0072 DUSK");

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(getByRole("alert")).toHaveTextContent("0.0072 DUSK");
      expect(getByRole("button", { name: "Review" })).toBeDisabled();
    });

    it("says what's missing of the fee, and nothing once the fee is lowered to what the balance pays", async () => {
      const { getByLabelText, getByRole, queryByRole } = render(LiquidStake, {
        ...stranded,
        availableBalance: 5_000_000n,
      });

      expect(getByRole("alert")).toHaveTextContent("0.005 DUSK");

      await fireEvent.click(getByRole("button", { name: "Edit" }));
      await fireEvent.input(getByLabelText(/gas limit/i), {
        target: { value: "5000000" },
      });

      expect(queryByRole("alert")).toBeNull();
    });

    it("says what's missing of the fee as it's edited, down to its minimum", async () => {
      const { getByLabelText, getByRole } = render(LiquidStake, stranded);

      await fireEvent.click(getByRole("button", { name: "Edit" }));
      await fireEvent.input(getByLabelText(/gas limit/i), {
        target: { value: "4000000" },
      });

      expect(getByRole("alert")).toHaveTextContent("0.0012 DUSK");
    });

    it("says what's missing of an empty balance too, and hides the figure, which gives a balance away, with the balances", () => {
      const empty = render(LiquidStake, { ...stranded, availableBalance: 0n });

      expect(empty.getByRole("alert")).toHaveTextContent("0.01 DUSK");

      cleanup();
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const hidden = render(LiquidStake, stranded);

        // Shown, it would say 0.0072 DUSK short.
        expect(hidden.getByRole("alert")).not.toHaveTextContent("0.0072");
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
    });
  });

  describe("what's held with Sozu", () => {
    const held = {
      sozu: {
        ...baseProps.sozu,
        status: statusWith({ balance: 100n * DUSK, stDusk: 32n * DUSK }),
      },
    };
    /** @param {Record<string, unknown>} [fields] */
    const call = (fields) =>
      /** @type {ActivityRow} */ ({
        hash: "a1",
        sozu: "stake",
        status: "executed",
        success: true,
        value: 90n * DUSK,
        ...fields,
      });

    it("says what's on its way, as after a reload while it went, and leaves it out of what can be staked or unstaked", async () => {
      const going = [
        call({
          hash: "a4",
          source: "sent",
          status: "pending",
          value: DUSK / 10n,
        }),
        call({
          hash: "a5",
          source: "sent",
          sozu: "unstake",
          status: "pending",
          value: 2n * DUSK,
        }),
      ];
      const { container, getByRole } = render(LiquidStake, {
        ...baseProps,
        ...held,
        history: { reading: false, rows: going, whole: true },
        underWay: going,
      });
      const banners = container.querySelectorAll(".liquid-stake__under-way");

      // Each on its way, with its amount.
      expect(banners).toHaveLength(2);
      expect(banners[0]).toHaveTextContent("0.1 DUSK");
      expect(banners[1]).toHaveTextContent("2 DUSK");

      // 172 DUSK less the 0.1 on its way.
      expect(textOf(container)).toContain("171.9 DUSK");

      // 100 DUSK less the 2 on their way back.
      await fireEvent.click(getByRole("tab", { name: "Unstake" }));

      expect(textOf(container)).toContain("98 DUSK");

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(getByRole("textbox", { name: "Unstake amount" })).toHaveValue(
        "98",
      );
    });

    it("hides all of it with the balances", () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { container } = render(LiquidStake, {
        ...baseProps,
        ...held,
        history: { reading: false, rows: [call()], whole: true },
      });

      expect(
        textOf(container.querySelector(".liquid-stake__position")),
      ).not.toMatch(/\d/);
      settingsStore.reset();
    });
  });

  it("unstakes up to what is staked with Sozu, back to the public balance", async () => {
    const { container, getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      action: "unstake",
      sozu: {
        ...baseProps.sozu,
        status: statusWith({
          balance: 15n * DUSK,
          stDusk: 4_878n * 10_000_00n,
        }),
      },
    });

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "16" },
    });

    // More than is staked with Sozu.
    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(getByLabelText("Unstake amount")).toHaveValue("15");
    // The amount, and what comes back, its fee apart.
    expect(container.querySelector(".stake-flow__rows dd")).toHaveTextContent(
      "15 DUSK",
    );
    expect(
      container.querySelector(".stake-flow__rows--total"),
    ).toHaveTextContent("15 DUSK");

    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("15") }));

    expect(baseProps.execute).toHaveBeenCalledWith(
      "unstake",
      POOL,
      15n * DUSK,
      1n,
      10_000_000n,
    );
  });

  it("can't send without Sozu's pool read, and offers to read it again", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: { error: new Error("timeout"), loading: false, status: null },
    });

    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByLabelText("Stake amount")).toBeDisabled();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(baseProps.onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the gas a review shows when the node's price changes", async () => {
    const execute = vi.fn().mockResolvedValue(HASH);
    const { getByLabelText, getByRole, rerender } = render(LiquidStake, {
      ...baseProps,
      execute,
    });

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await rerender({ gas: gasAt(3n) });
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        "stake",
        POOL,
        100n * DUSK,
        1n,
        5_000_000n,
      ),
    );
  });

  it("takes each action's own gas: a tab's default follows the tab, and says what an unstake brings back after its fee", async () => {
    const { container, getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith({ balance: 15n * DUSK, stDusk: 4n * DUSK }),
      },
    });
    const total = () =>
      textOf(container.querySelector(".stake-flow__rows--total"));
    const warning = () => container.querySelector(".stake-flow__final");

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1" },
    });

    expect(total()).toContain("1.005 DUSK");

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });

    expect(total()).toContain("1 DUSK");

    // So small the fee can take more than comes back: said on the review.
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "0.005" },
    });

    expect(total()).toContain("0.005 DUSK");

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(warning()).toHaveTextContent("0.01 DUSK");

    await fireEvent.click(getByRole("button", { name: "Back" }));
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(warning()).toBeNull();

    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("1") }));

    // An unstake doesn't wait for Sozu's terms: it has none to read.
    expect(baseProps.recheck).not.toHaveBeenCalled();

    expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
      "unstake",
      POOL,
      DUSK,
      1n,
      10_000_000n,
    );
  });

  it("stops stakes, not unstakes, while Sozu has paused deposits", async () => {
    const paused = statusWith(
      { balance: 15n * DUSK, stDusk: 4n * DUSK },
      FEES,
      { maintenance: true, synchronization: false },
    );
    const { getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: { ...baseProps.sozu, status: paused },
    });

    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByLabelText("Stake amount")).toBeDisabled();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });

    expect(getByRole("button", { name: "Review" })).toBeEnabled();

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: showsDusk("1") })).toBeEnabled();
  });

  it("warns that a call can fail while Sozu synchronizes its pool", () => {
    const { getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith({}, FEES, {
          maintenance: false,
          synchronization: true,
        }),
      },
    });

    expect(getByRole("status")).toBeInTheDocument();

    cleanup();

    // Not while it doesn't.
    expect(render(LiquidStake, baseProps).queryByRole("status")).toBeNull();
  });

  describe("Sozu's terms, read again before a stake goes", () => {
    /** Sozu's deposit fee raised to 1%. */
    const RAISED = { ...FEES, deposit: { denominator: 100n, numerator: 1n } };
    const NEW_POOL = "ee".repeat(32);

    /**
     * Renders liquid staking with Sozu reading `next` when it's read again,
     * the status shown following, as the staking page's store makes it.
     *
     * @param {SozuStatus | null} next
     */
    function renderReading(next) {
      /** @type {() => Promise<void>} */
      let follow = async () => {};
      const recheck = vi.fn(async () => {
        await follow();

        return next;
      });
      const view = render(LiquidStake, { ...baseProps, recheck });

      follow = async () => {
        if (next) {
          await view.rerender({
            sozu: { error: null, loading: false, status: next },
          });
        }
      };

      return { ...view, recheck };
    }

    /** @param {HTMLElement} container */
    const changedNote = (container) =>
      textOf(container.querySelector(".liquid-stake__changed"));

    it.each([
      {
        fee: "1 DUSK",
        next: statusWith({}, RAISED),
        pool: POOL,
        what: "the deposit fee",
      },
      {
        fee: "0.25 DUSK",
        next: statusWith({}, FEES, OPEN, NEW_POOL),
        pool: NEW_POOL,
        what: "the pool",
      },
      {
        fee: "0.25 DUSK",
        next: statusWith({}, FEES, { ...OPEN, synchronization: true }),
        pool: POOL,
        what: "the switches: the pool synchronizes now",
      },
    ])(
      "sends nothing when $what changed, shows the figures now, and sends once they're confirmed",
      async ({ fee, next, pool }) => {
        const { container, getByLabelText, getByRole, recheck } =
          renderReading(next);

        await fireEvent.input(getByLabelText("Stake amount"), {
          target: { value: "100" },
        });
        await fireEvent.click(getByRole("button", { name: "Review" }));
        await afterConfirmDelay();
        await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

        await vi.waitFor(() => expect(changedNote(container)).toBeTruthy());
        expect(baseProps.execute).not.toHaveBeenCalled();
        // The deposit fee now.
        expect(summaryOf(container)).toContain(fee);

        // Confirmed again, on the same terms: it goes.
        await afterConfirmDelay();
        await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

        await vi.waitFor(() =>
          expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
            "stake",
            pool,
            100n * DUSK,
            1n,
            5_000_000n,
          ),
        );
        expect(recheck).toHaveBeenCalledTimes(2);
      },
    );

    it("takes no click for half a second once the changed terms show, so a double click can't confirm figures not seen", async () => {
      const { container, getByLabelText, getByRole, recheck } = renderReading(
        statusWith({}, RAISED),
      );
      const stake = () => getByRole("button", { name: showsDusk("100") });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(stake());
      // On the page's clock, which only the test moves on.
      await waitFor(() => expect(changedNote(container)).toBeTruthy());

      // The second click of a double click, and Enter, as the new figures show.
      await fireEvent.click(stake());
      await fireEvent.click(stake(), { detail: 0 });
      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
      await fireEvent.click(stake());

      expect(recheck).toHaveBeenCalledOnce();
      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(stake()).toBeEnabled();

      await vi.advanceTimersByTimeAsync(1);
      await fireEvent.click(stake());

      await vi.waitFor(() =>
        expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
          "stake",
          POOL,
          100n * DUSK,
          1n,
          5_000_000n,
        ),
      );
    });

    it("keeps the stake off when Sozu paused deposits since the summary showed", async () => {
      const { container, getByLabelText, getByRole } = renderReading(
        statusWith({}, FEES, { maintenance: true, synchronization: false }),
      );

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

      await vi.waitFor(() => expect(changedNote(container)).toBeTruthy());
      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(getByRole("button", { name: "Stake with Sozu" })).toBeDisabled();
    });

    it.each([
      { recheck: async () => null, what: "isn't read" },
      {
        recheck: async () => {
          throw new Error("offline");
        },
        what: "can't be read",
      },
    ])(
      "sends nothing when Sozu's status $what, and says so",
      async ({ recheck }) => {
        const { container, findByRole, getByLabelText, getByRole } = render(
          LiquidStake,
          { ...baseProps, recheck },
        );

        await fireEvent.input(getByLabelText("Stake amount"), {
          target: { value: "100" },
        });
        await fireEvent.click(getByRole("button", { name: "Review" }));
        await afterConfirmDelay();
        await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

        // Said, and nothing sent.
        expect(await findByRole("alert")).toBeInTheDocument();
        expect(baseProps.execute).not.toHaveBeenCalled();
        expect(changedNote(container)).toBeUndefined();
      },
    );
  });

  describe("while Sozu's terms are read again before a stake goes", () => {
    /** A read of Sozu's terms that answers when `answer` is called: as they were. */
    function slowRecheck() {
      /** @type {() => void} */
      let answer = () => {};
      const recheck = vi.fn(
        () =>
          new Promise((resolve) => {
            answer = () => resolve(statusWith());
          }),
      );

      return { answer: () => answer(), recheck };
    }

    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("sends nothing once the page is left", async () => {
      const { answer, recheck } = slowRecheck();
      const { getByLabelText, getByRole, unmount } = render(LiquidStake, {
        ...baseProps,
        recheck,
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));
      unmount();
      answer();
      await settled();

      expect(recheck).toHaveBeenCalledOnce();
      expect(baseProps.execute).not.toHaveBeenCalled();
    });

    it("sends nothing once the review is left", async () => {
      const { answer, recheck } = slowRecheck();
      const { getByLabelText, getByRole } = render(LiquidStake, {
        ...baseProps,
        recheck,
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));
      await fireEvent.click(getByRole("button", { name: "Back" }));
      answer();
      await settled();

      expect(baseProps.execute).not.toHaveBeenCalled();
    });

    it("sends nothing when the amount changed meanwhile, and the new one once confirmed", async () => {
      const { answer, recheck } = slowRecheck();
      const { container, getByLabelText, getByRole } = render(LiquidStake, {
        ...baseProps,
        recheck,
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));
      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "50" },
      });
      answer();
      await settled();

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(container.querySelector(".liquid-stake__changed")).toBeNull();

      recheck.mockResolvedValue(statusWith());
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("50") }));

      await vi.waitFor(() =>
        expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
          "stake",
          POOL,
          50n * DUSK,
          1n,
          5_000_000n,
        ),
      );
    });

    it("sends on the gas the review shows, though the node's price came in meanwhile", async () => {
      const { answer, recheck } = slowRecheck();
      const { getByLabelText, getByRole, rerender } = render(LiquidStake, {
        ...baseProps,
        recheck,
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));
      await rerender({ gas: gasAt(3n) });
      answer();

      await vi.waitFor(() =>
        expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
          "stake",
          POOL,
          100n * DUSK,
          1n,
          5_000_000n,
        ),
      );
    });

    it("keeps the button off, so that a double click sends one stake", async () => {
      const { answer, recheck } = slowRecheck();
      const { getByLabelText, getByRole } = render(LiquidStake, {
        ...baseProps,
        recheck,
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));

      const button = getByRole("button", { name: showsDusk("100") });

      await afterConfirmDelay();
      await fireEvent.click(button);

      expect(button).toBeDisabled();

      await fireEvent.click(button);
      answer();

      await vi.waitFor(() => expect(baseProps.execute).toHaveBeenCalledOnce());
      expect(recheck).toHaveBeenCalledOnce();
    });
  });

  it("keeps staking off while Sozu's deposits can't be checked, not unstaking", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith({ balance: 15n * DUSK, stDusk: 4n * DUSK }, FEES, {
          maintenance: null,
          synchronization: false,
        }),
      },
    });

    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByLabelText("Stake amount")).toBeDisabled();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));

    expect(getByLabelText("Unstake amount")).toBeEnabled();
  });

  it("says no stake gets stDUSK while Sozu's deposit fee is 100%", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith(
          {},
          { ...FEES, deposit: { denominator: 1n, numerator: 1n } },
        ),
      },
    });

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();
  });
});
