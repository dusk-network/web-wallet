import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

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
  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    baseProps.onRetry.mockClear();
    baseProps.recheck.mockClear();
  });

  it("says Sozu, a third party, holds what is staked here", () => {
    const { container, getByRole } = render(LiquidStake, baseProps);

    expect(textOf(container.querySelector(".liquid-stake__intro"))).toBe(
      "Sozu third party Sozu, not Dusk, holds the DUSK you stake here and returns it under Sozu's own rules: sozu.fi."
    );
    expect(getByRole("link", { name: "sozu.fi" })).toHaveAttribute(
      "href",
      "https://sozu.fi/"
    );
    expect(textOf(container.querySelector(".liquid-stake__facts"))).toContain(
      "Any amount, no node needed You get stDUSK, a token for your share of Sozu's pool."
    );
    // Sozu's fees, as its substrate gives them, and none to unstake.
    expect(textOf(container.querySelector(".liquid-stake__facts"))).toContain(
      "Sozu's fees 0.25% of each deposit · 15% of rewards · no unstake fee"
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
      "Getting it back Unstake any time. No fee, no waiting.",
      "Fee paid from Public balance",
      "Total Up to 100.005 DUSK",
    ]);
    expect(textOf(container.querySelector(".liquid-stake__gas-note"))).toBe(
      "A call that fails is charged its whole gas limit."
    );

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

  it("refuses a stake too small to get any stDUSK, saying the least", async () => {
    const { getByLabelText, getByRole } = render(LiquidStake, baseProps);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0.000000001" },
    });

    // 4 lux gets stDUSK at the rate, so 5 does once the fee is off it.
    expect(getByRole("alert")).toHaveTextContent(
      "The minimum stake is 0.000000005 DUSK."
    );
    expect(getByRole("button", { name: "Stake with Sozu" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "0.000000005" },
    });

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

  it("says when a stake is more than the public balance, with the fee", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "172" },
    });

    expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
      "That's 0.005 DUSK more than the public balance, with the network fee."
    );
    expect(getByRole("button", { name: "Stake with Sozu" })).toBeDisabled();

    // What is typed shows in the summary, muted.
    const [stake] = container.querySelectorAll(".stake-flow__rows dd");

    expect(stake).toHaveTextContent("172 DUSK");
    expect(stake).toHaveClass("stake-flow__muted");
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
      "The DUSK comes back in the same transaction. No fee, no waiting."
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
    expect(getByRole("button", { name: "Stake with Sozu" })).toBeDisabled();

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));
    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "1" },
    });

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

    it("keeps the stake off when Sozu paused deposits since the summary showed", async () => {
      const { container, getByLabelText, getByRole, getByText } = renderReading(
        statusWith({}, FEES, { maintenance: true, synchronization: false })
      );

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
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

    it("sends nothing when the node's gas price came in meanwhile, and the new gas once confirmed", async () => {
      const { answer, recheck } = slowRecheck();
      const { getByLabelText, getByRole, rerender } = render(LiquidStake, {
        ...baseProps,
        recheck,
      });

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "100" },
      });
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );
      // The summary shows the fee at the node's price now.
      await rerender({ gas: gasAt(3n) });
      answer();
      await settled();

      expect(baseProps.execute).not.toHaveBeenCalled();

      recheck.mockResolvedValue(statusWith());
      await fireEvent.click(
        getByRole("button", { name: "Stake 100 DUSK with Sozu" })
      );

      await vi.waitFor(() =>
        expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
          "stake",
          POOL,
          100n * DUSK,
          3n,
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

      const button = getByRole("button", { name: "Stake 100 DUSK with Sozu" });

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
    expect(getByRole("button", { name: "Stake with Sozu" })).toBeDisabled();

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
    expect(getByRole("button", { name: "Stake with Sozu" })).toBeDisabled();
  });
});
