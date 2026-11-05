import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/svelte";

import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import { settingsStore } from "$lib/stores";

import { LiquidStake } from "..";

const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
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

  it("names Sozu, a third party, with its site and no more", () => {
    const { container, getByRole } = render(LiquidStake, baseProps);

    // The terms are Dusk's own, linked under Settings › Support: none here.
    expect(textOf(container.querySelector(".liquid-stake__intro"))).toBe(
      "Sozu third party sozu.fi"
    );
    expect(
      within(
        /** @type {HTMLElement} */ (
          container.querySelector(".liquid-stake__who")
        )
      ).getByRole("link", { name: "sozu.fi" })
    ).toHaveAttribute("href", "https://sozu.fi/");
    expect(getByRole("link", { name: "sozu.fi" })).toHaveAttribute(
      "target",
      "_blank"
    );
    expect(textOf(container.querySelector(".liquid-stake__facts"))).toContain(
      "Any amount, no node needed You get stDUSK, a token for your share of Sozu's pool."
    );
    // Sozu's fees, as its substrate gives them, and none to unstake.
    expect(textOf(container.querySelector(".liquid-stake__facts"))).toContain(
      "Sozu's fees 0.25% of each deposit · 15% of rewards · no unstake fee"
    );
    // Its contract isn't one of the facts: it's under the fee's Edit.
    expect(textOf(container.querySelector(".liquid-stake__facts"))).not.toMatch(
      /contract/i
    );
  });

  it("stakes any amount with Sozu's pool, saying about what it gets", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    // For what's left once Sozu's 0.25% deposit fee is off it, and what
    // that's worth now.
    expect(textOf(container.querySelector(".liquid-stake__estimate"))).toBe(
      "You get about 32.4378 stDUSK, worth about 99.75 DUSK now. stDUSK is Sozu's token for your share. Its DUSK value follows Sozu's pool, its rewards and its fees."
    );
    expect(
      Array.from(container.querySelectorAll(".stake-flow__rows > div"), textOf)
    ).toStrictEqual([
      "Stake with Sozu 100 DUSK",
      "You get about 32.4378 stDUSK",
      "Deposit fee 0.25% · 0.25 DUSK",
      "Getting it back Unstake any time. No Sozu fee, no waiting.",
      "Fee paid from Public balance",
      "Total Up to 100.005 DUSK",
    ]);
    // No line about what a failed call is charged.
    expect(container).not.toHaveTextContent(/fails/);

    // The pool it calls, named, with its ID to copy, under the fee's Edit.
    expect(container.querySelector(".liquid-stake__contract")).toBeNull();

    await fireEvent.click(getByRole("button", { name: "Edit" }));

    expect(textOf(container.querySelector(".liquid-stake__contract"))).toBe(
      "Contract Sozu pool · 728839…3078f2 Copy"
    );
    expect(
      getByRole("button", { name: "Copy contract ID" })
    ).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(baseProps.execute).not.toHaveBeenCalled();
    expect(baseProps.recheck).not.toHaveBeenCalled();

    await afterConfirmDelay();
    await fireEvent.click(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    );

    // A stake's own gas: 5,000,000 at the node's price, once Sozu's terms
    // are read again.
    await vi.waitFor(() =>
      expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
        "stake",
        POOL,
        100n * DUSK,
        1n,
        5_000_000n
      )
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
      const { container, getByLabelText, getByRole, queryByRole } = render(
        LiquidStake,
        baseProps
      );

      await typed(getByLabelText);
      await afterConfirmDelay();

      expect(queryByRole("button", { name: /^Stake/ })).toBeNull();
      expect(container.querySelector(".stake-flow")).not.toHaveClass(
        "stake-flow--review"
      );

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(baseProps.recheck).not.toHaveBeenCalled();
      expect(container.querySelector(".stake-flow")).toHaveClass(
        "stake-flow--review"
      );
      expect(queryByRole("button", { name: "Review" })).toBeNull();
      expect(getByRole("heading", { name: /Review/ })).toHaveFocus();
    });

    it("goes back to the form, with what's typed, and sends only once pressed from the review", async () => {
      const { getByLabelText, getByRole, queryByRole } = render(
        LiquidStake,
        baseProps
      );

      await typed(getByLabelText);
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await fireEvent.click(getByRole("button", { name: "Back" }));

      expect(getByLabelText("Stake amount")).toHaveValue("100");
      expect(queryByRole("button", { name: /^Stake/ })).toBeNull();
      expect(baseProps.execute).not.toHaveBeenCalled();
    });

    it("says on the review that the deposit fee doesn't come back, with its amount", async () => {
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        baseProps
      );

      await typed(getByLabelText);

      expect(container).not.toHaveTextContent("doesn't come back");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(textOf(container.querySelector(".stake-flow__final"))).toBe(
        "The deposit fee of 0.25 DUSK doesn't come back."
      );
    });

    it("hides that amount with the balances, and says it without one where the fee couldn't be read", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const hidden = render(LiquidStake, baseProps);

        await typed(hidden.getByLabelText);
        await fireEvent.click(hidden.getByRole("button", { name: "Review" }));

        expect(
          textOf(hidden.container.querySelector(".stake-flow__final"))
        ).toBe("The deposit fee of •••• hidden DUSK doesn't come back.");
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

      expect(textOf(unread.container.querySelector(".stake-flow__final"))).toBe(
        "Sozu's deposit fee doesn't come back."
      );
    });

    it("says nothing of a deposit fee on an unstake's review", async () => {
      const { container, getByLabelText, getByRole } = render(LiquidStake, {
        ...baseProps,
        action: "unstake",
        sozu: {
          ...baseProps.sozu,
          status: statusWith({ balance: 15n * DUSK, stDusk: 4n * DUSK }),
        },
      });

      await fireEvent.input(getByLabelText("Unstake amount"), {
        target: { value: "1" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(container.querySelector(".stake-flow__final")).toBeNull();
      expect(getByRole("button", { name: "Unstake 1 DUSK" })).toBeEnabled();
    });
  });

  it("takes an amount with a decimal comma, as Send does, and Max in the language's way", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0,5" },
    });

    expect(container.querySelector(".stake-flow__rows dd")).toHaveTextContent(
      "0.5 DUSK"
    );

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(
      getByRole("button", { name: "Stake 0.5 DUSK with Sozu" })
    ).toBeEnabled();
  });

  it("hides the DUSK of Sozu's deposit fee with the balances, not its rate", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText } = render(LiquidStake, baseProps);

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "50" },
      });

      expect(
        Array.from(
          container.querySelectorAll(".stake-flow__rows > div"),
          textOf
        ).find((row) => row?.startsWith("Deposit fee"))
      ).toBe("Deposit fee 0.25% · •••• hidden DUSK");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
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
    expect(getByRole("alert")).toHaveTextContent(
      "The minimum unstake is 0.000000004 DUSK."
    );
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "0.000000004" },
    });

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(
      getByRole("button", { name: "Unstake 0.000000004 DUSK" })
    ).toBeEnabled();
    cleanup();

    // All of a smaller stake burns all its stDUSK.
    const small = unstakeOf(3n);

    await fireEvent.input(small.getByLabelText("Unstake amount"), {
      target: { value: "0.000000003" },
    });

    await fireEvent.click(small.getByRole("button", { name: "Review" }));

    expect(
      small.getByRole("button", { name: "Unstake 0.000000003 DUSK" })
    ).toBeEnabled();
  });

  it("refuses a stake too small to get any stDUSK, saying the least", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, baseProps);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0.000000001" },
    });

    // 4 lux gets stDUSK at the rate, so 5 does once the fee is off it.
    expect(getByRole("alert")).toHaveTextContent(
      "The minimum stake is 0.000000005 DUSK."
    );
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0.000000005" },
    });

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(
      getByRole("button", { name: "Stake 0.000000005 DUSK with Sozu" })
    ).toBeEnabled();
  });

  it("says Sozu's deposit fee as the contract gives it, and where it couldn't be read, that it's taken from the deposit", async () => {
    const rows = async (/** @type {SozuFees | null} */ fees) => {
      const { container, getByLabelText } = render(LiquidStake, {
        ...baseProps,
        sozu: { error: null, loading: false, status: statusWith({}, fees) },
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "1" },
      });

      const fee = textOf(
        Array.from(container.querySelectorAll(".stake-flow__rows > div")).find(
          (row) => textOf(row)?.startsWith("Deposit fee")
        ) ?? null
      );

      cleanup();

      return fee;
    };

    expect(await rows(FEES)).toBe("Deposit fee 0.25% · 0.0025 DUSK");
    expect(
      await rows({ ...FEES, deposit: { denominator: 100n, numerator: 1n } })
    ).toBe("Deposit fee 1% · 0.01 DUSK");
    expect(await rows(null)).toBe("Deposit fee Taken from the deposit");
  });

  it("doesn't let an amount give away the balance while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText } = render(LiquidStake, baseProps);
      const error = async (/** @type {string} */ value) => {
        await fireEvent.input(getByLabelText("Stake amount"), {
          target: { value },
        });

        return textOf(container.querySelector(".liquid-stake__error"));
      };

      expect(await error("172")).toBe(
        "That leaves too little for this fee and the fee to unstake later."
      );
      expect(await error("999")).toBe("More than you have.");
      expect(textOf(container)).not.toMatch(/\d DUSK more/);
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("hides what Max fills in while balances are hidden, and shows what's typed over it", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        baseProps
      );

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(getByLabelText("Stake amount")).toHaveValue("••••");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: /^Stake •••• DUSK/ })).toBeEnabled();
      for (const row of container.querySelectorAll(".stake-flow__rows dd")) {
        expect(textOf(row)).not.toMatch(/\d (st)?DUSK/);
      }

      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "5" },
      });

      expect(getByLabelText("Stake amount")).toHaveValue("5");

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(getByRole("button", { name: /^Stake 5 DUSK/ })).toBeEnabled();
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("says when a stake is more than the public balance, with this fee and the fee to unstake later", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "172" },
    });

    expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
      "That's 0.015 DUSK more than the public balance, with this fee and the fee to unstake later."
    );
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    // What is typed shows in the summary, muted.
    const [stake] = container.querySelectorAll(".stake-flow__rows dd");

    expect(stake).toHaveTextContent("172 DUSK");
    expect(stake).toHaveClass("stake-flow__muted");
  });

  describe("what a stake leaves to get back out with", () => {
    const shown = { ...baseProps, availableBalance: DUSK };

    it("keeps this fee and the fee to unstake with Max, which then pays for that unstake", async () => {
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        shown
      );

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // 1 DUSK, less 0.005 for this stake and 0.01 for the unstake.
      expect(getByLabelText("Stake amount")).toHaveValue("0.985");
      expect(container).toHaveTextContent(
        "Max keeps 0.015 DUSK: up to 0.005 for this fee and 0.01 to unstake later."
      );
      expect(getByRole("button", { name: "Max" })).toHaveAttribute(
        "title",
        "All of it, less the network fee and the fee to unstake later"
      );

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(
        getByRole("button", { name: "Stake 0.985 DUSK with Sozu" })
      ).toBeEnabled();

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
        after.getByRole("button", { name: "Unstake 0.97 DUSK" })
      ).toBeEnabled();
    });

    it("refuses an amount typed that leaves too little to unstake, as Max would", async () => {
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        shown
      );

      // All but this stake's own fee: the most it took before.
      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "0.995" },
      });

      expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
        "That's 0.01 DUSK more than the public balance, with this fee and the fee to unstake later."
      );
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
      const { container, getByLabelText, getByRole } = render(
        LiquidStake,
        stranded
      );
      const said =
        "The public balance doesn't cover the network fee: 0.0072 DUSK short. Add that much to it first.";

      expect(getByLabelText("Unstake amount")).toHaveValue("");
      expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
        said
      );
      expect(container.querySelector("[role='alert']")).toHaveTextContent(said);

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
        said
      );
      expect(getByRole("button", { name: "Review" })).toBeDisabled();
    });

    it("says what's missing of an empty balance too, and hides the figure, which gives a balance away, with the balances", () => {
      const empty = render(LiquidStake, { ...stranded, availableBalance: 0n });

      expect(
        textOf(empty.container.querySelector(".liquid-stake__error"))
      ).toBe(
        "The network fee is paid from the public balance, and it's empty: 0.01 DUSK short. Add that much to it first."
      );

      cleanup();
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        const hidden = render(LiquidStake, stranded);

        expect(
          textOf(hidden.container.querySelector(".liquid-stake__error"))
        ).toBe(
          "The public balance doesn't cover the network fee: •••• DUSK short."
        );
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
      }
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

    expect(textOf(container.querySelector(".liquid-stake__position"))).toBe(
      "Staked with Sozu 15 DUSK stDUSK 4.878 stDUSK"
    );
    expect(getByRole("tab", { name: "Unstake" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // Sozu pays it out at once.
    expect(textOf(container.querySelector(".liquid-stake__estimate"))).toBe(
      "The DUSK comes back in the same transaction. No Sozu fee, no waiting."
    );

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "16" },
    });

    expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
      "That's more than you have staked with Sozu."
    );

    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(getByLabelText("Unstake amount")).toHaveValue("15");
    expect(
      Array.from(container.querySelectorAll(".stake-flow__rows > div"), textOf)
    ).toStrictEqual([
      "Unstake from Sozu 15 DUSK",
      "Back to Your public balance, in the same transaction",
      "Sozu's fee No unstake fee",
      "Fee paid from Public balance",
      "Total Up to 0.01 DUSK",
    ]);

    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Unstake 15 DUSK" }));

    expect(baseProps.execute).toHaveBeenCalledWith(
      "unstake",
      POOL,
      15n * DUSK,
      1n,
      10_000_000n
    );
  });

  it("keeps each tab's amount, and moves between the tabs with the arrow keys", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, baseProps);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "7" },
    });
    await fireEvent.keyDown(getByRole("tab", { name: "Stake" }), {
      key: "ArrowRight",
    });

    expect(getByRole("tab", { name: "Unstake" })).toHaveFocus();
    expect(getByLabelText("Unstake amount")).toHaveValue("");

    await fireEvent.click(getByRole("tab", { name: "Stake" }));

    expect(getByLabelText("Stake amount")).toHaveValue("7");
  });

  it("can't send without Sozu's pool read, and offers to read it again", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: { error: new Error("timeout"), loading: false, status: null },
    });

    expect(getByRole("alert")).toHaveTextContent(
      "Couldn't reach Sozu. Check your connection."
    );
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
    await fireEvent.click(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    );

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        "stake",
        POOL,
        100n * DUSK,
        1n,
        5_000_000n
      )
    );
  });

  it("takes each action's own gas: a tab's default follows the tab", async () => {
    const { container, getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith({ balance: 15n * DUSK, stDusk: 4n * DUSK }),
      },
    });
    const total = () =>
      textOf(container.querySelector(".stake-flow__rows--total"));

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1" },
    });

    expect(total()).toBe("Total Up to 1.005 DUSK");

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });

    expect(total()).toBe("Total Up to 0.01 DUSK");

    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Unstake 1 DUSK" }));

    // An unstake doesn't wait for Sozu's terms: it has none to read.
    expect(baseProps.recheck).not.toHaveBeenCalled();

    expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
      "unstake",
      POOL,
      DUSK,
      1n,
      10_000_000n
    );
  });

  it("stops stakes, not unstakes, while Sozu has paused deposits", async () => {
    const paused = statusWith(
      { balance: 15n * DUSK, stDusk: 4n * DUSK },
      FEES,
      { maintenance: true, synchronization: false }
    );
    const { getByLabelText, getByRole } = render(LiquidStake, {
      ...baseProps,
      sozu: { ...baseProps.sozu, status: paused },
    });

    expect(getByRole("alert")).toHaveTextContent(
      "Sozu has paused deposits. Unstaking still works."
    );
    expect(getByLabelText("Stake amount")).toBeDisabled();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });

    expect(getByRole("button", { name: "Review" })).toBeEnabled();

    await fireEvent.click(getByRole("button", { name: "Review" }));

    expect(getByRole("button", { name: "Unstake 1 DUSK" })).toBeEnabled();
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

    expect(getByRole("status")).toHaveTextContent(
      "Sozu is updating its pool, so a stake or an unstake sent now can fail."
    );

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
        next: statusWith({}, RAISED),
        pool: POOL,
        shows: "Deposit fee 1% · 1 DUSK",
        what: "the deposit fee",
      },
      {
        next: statusWith({}, FEES, OPEN, NEW_POOL),
        pool: NEW_POOL,
        shows: "Deposit fee 0.25% · 0.25 DUSK",
        what: "the pool",
      },
      {
        next: statusWith({}, FEES, { ...OPEN, synchronization: true }),
        pool: POOL,
        shows: "Deposit fee 0.25% · 0.25 DUSK",
        what: "the switches: the pool synchronizes now",
      },
    ])(
      "sends nothing when $what changed, shows the figures now, and sends once they're confirmed",
      async ({ next, pool, shows }) => {
        const { container, getByLabelText, getByRole, recheck } =
          renderReading(next);

        await fireEvent.input(getByLabelText("Stake amount"), {
          target: { value: "100" },
        });
        await fireEvent.click(getByRole("button", { name: "Review" }));
        await afterConfirmDelay();
        await fireEvent.click(
          getByRole("button", { name: "Stake 100 DUSK with Sozu" })
        );

        await vi.waitFor(() =>
          expect(changedNote(container)).toBe(
            "Sozu's terms changed These are the figures now. Check them, then confirm again."
          )
        );
        expect(baseProps.execute).not.toHaveBeenCalled();
        expect(
          Array.from(
            container.querySelectorAll(".stake-flow__rows > div"),
            textOf
          )
        ).toContain(shows);

        // Confirmed again, on the same terms: it goes.
        await afterConfirmDelay();
        await fireEvent.click(
          getByRole("button", { name: "Stake 100 DUSK with Sozu" })
        );

        await vi.waitFor(() =>
          expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
            "stake",
            pool,
            100n * DUSK,
            1n,
            5_000_000n
          )
        );
        expect(recheck).toHaveBeenCalledTimes(2);
      }
    );

    it("takes no click for half a second once the changed terms show, so a double click can't confirm figures not seen", async () => {
      const { container, getByLabelText, getByRole, recheck } = renderReading(
        statusWith({}, RAISED)
      );
      const stake = () =>
        getByRole("button", { name: "Stake 100 DUSK with Sozu" });

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
          5_000_000n
        )
      );
    });

    it("keeps the stake off when Sozu paused deposits since the summary showed", async () => {
      const { container, getByLabelText, getByRole, getByText } = renderReading(
        statusWith({}, FEES, { maintenance: true, synchronization: false })
      );

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );

      await vi.waitFor(() => expect(changedNote(container)).toBeTruthy());
      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(getByText("Sozu has paused deposits.")).toBeInTheDocument();
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
        const { container, getByLabelText, getByRole, findByText } = render(
          LiquidStake,
          { ...baseProps, recheck }
        );

        await fireEvent.input(getByLabelText("Stake amount"), {
          target: { value: "100" },
        });
        await fireEvent.click(getByRole("button", { name: "Review" }));
        await afterConfirmDelay();
        await fireEvent.click(
          getByRole("button", { name: "Stake 100 DUSK with Sozu" })
        );

        const error = await findByText(
          "Couldn't check Sozu's terms just now, so nothing was sent."
        );

        expect(textOf(error.parentElement)).toBe(
          "Couldn't check Sozu's terms just now, so nothing was sent. Try again."
        );
        expect(baseProps.execute).not.toHaveBeenCalled();
        expect(changedNote(container)).toBeUndefined();
      }
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
          })
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
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );
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
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );
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
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );
      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "50" },
      });
      answer();
      await settled();

      expect(baseProps.execute).not.toHaveBeenCalled();
      expect(container.querySelector(".liquid-stake__changed")).toBeNull();

      recheck.mockResolvedValue(statusWith());
      await afterConfirmDelay();
      await fireEvent.click(
        getByRole("button", { name: "Stake 50 DUSK with Sozu" })
      );

      await vi.waitFor(() =>
        expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
          "stake",
          POOL,
          50n * DUSK,
          1n,
          5_000_000n
        )
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
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );
      await rerender({ gas: gasAt(3n) });
      answer();

      await vi.waitFor(() =>
        expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
          "stake",
          POOL,
          100n * DUSK,
          1n,
          5_000_000n
        )
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

      const button = getByRole("button", { name: "Stake 100 DUSK with Sozu" });

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
    const { getByLabelText, getByRole, getByText } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith({ balance: 15n * DUSK, stDusk: 4n * DUSK }, FEES, {
          maintenance: null,
          synchronization: false,
        }),
      },
    });

    expect(
      textOf(getByText("Sozu's deposits couldn't be checked.").parentElement)
    ).toBe(
      "Sozu's deposits couldn't be checked. Staking stays off until they can be. Unstaking still works."
    );
    expect(getByLabelText("Stake amount")).toBeDisabled();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));

    expect(getByLabelText("Unstake amount")).toBeEnabled();
  });

  it("says no stake gets stDUSK while Sozu's deposit fee is 100%", async () => {
    const { getByLabelText, getByRole, getByText } = render(LiquidStake, {
      ...baseProps,
      sozu: {
        ...baseProps.sozu,
        status: statusWith(
          {},
          { ...FEES, deposit: { denominator: 1n, numerator: 1n } }
        ),
      },
    });

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    expect(
      getByText("No stake gets stDUSK at Sozu's deposit fee now.")
    ).toBeInTheDocument();
    expect(getByRole("button", { name: "Review" })).toBeDisabled();
  });
});
