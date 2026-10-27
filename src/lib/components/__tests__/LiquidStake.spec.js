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

/**
 * @param {Partial<SozuStatus["position"]>} position
 * @param {SozuFees | null} [fees]
 */
const statusWith = (position = {}, fees = FEES) => ({
  contracts: { hub: "aa".repeat(32), pool: POOL, stDusk: "dd".repeat(32) },
  fees,
  pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
  position: { balance: 0n, stDusk: 0n, ...position },
});

const baseProps = {
  availableBalance: 172n * DUSK,
  execute: vi.fn().mockResolvedValue(HASH),
  gasLimits: {
    gasLimitLower: 4_000_000n,
    gasLimitUpper: 1_000_000_000n,
    gasPriceLower: 1n,
  },
  gasSettings: { gasLimit: 10_000_000n, gasPrice: 1n },
  onRetry: vi.fn(),
  sozu: { error: null, loading: false, status: statusWith() },
};

/** @param {Element | null} element */
const textOf = (element) => element?.textContent?.replace(/\s+/g, " ").trim();

describe("LiquidStake", () => {
  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
    baseProps.onRetry.mockClear();
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
  });

  it("stakes any amount with Sozu's pool, saying about what it gets", async () => {
    const { container, getByLabelText, getByRole } = render(
      LiquidStake,
      baseProps
    );

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    // For what's left once Sozu's 0.25% deposit fee is off it.
    expect(textOf(container.querySelector(".liquid-stake__estimate"))).toBe(
      "You get about 32.4378 stDUSK, at the rate Sozu's contract gives now. stDUSK is Sozu's token for your share. Its DUSK value follows Sozu's pool, its rewards and its fees."
    );
    expect(
      Array.from(container.querySelectorAll(".stake-flow__rows > div"), textOf)
    ).toStrictEqual([
      "Stake with Sozu 100 DUSK",
      "You get about 32.4378 stDUSK",
      "Deposit fee 0.25% · 0.25 DUSK",
      "Getting it back Unstake from Sozu, under Sozu's rules",
      "Fee paid from Public balance",
      "Total Up to 100.01 DUSK",
    ]);

    await fireEvent.click(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    );

    expect(baseProps.execute).toHaveBeenCalledExactlyOnceWith(
      "stake",
      POOL,
      100n * DUSK,
      1n,
      10_000_000n
    );
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
      "That's 0.01 DUSK more than the public balance, with the network fee."
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

    await fireEvent.input(getByLabelText("Unstake amount"), {
      target: { value: "16" },
    });

    expect(textOf(container.querySelector(".liquid-stake__error"))).toBe(
      "That's more than you have staked with Sozu."
    );

    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(getByLabelText("Unstake amount")).toHaveValue("15");
    expect(textOf(container.querySelector(".stake-flow__rows"))).toContain(
      "Back to Your public balance"
    );

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
    await rerender({ gasSettings: { gasLimit: 10_000_000n, gasPrice: 3n } });
    await fireEvent.click(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    );

    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "stake",
      POOL,
      100n * DUSK,
      1n,
      10_000_000n
    );
  });
});
