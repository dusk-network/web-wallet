import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { NativeStake } from "..";
import {
  checkAmount,
  normalizeDuskInput,
  parseDuskInput,
} from "../Stake/stakeAmount";

// The transaction sent stays pending.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  ...(await importOriginal()),
  followTransaction,
}));

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
};

describe("parseDuskInput", () => {
  it("reads DUSK as lux, with up to nine decimals and nothing else", () => {
    expect(parseDuskInput("1000")).toBe(1_000n * DUSK);
    expect(parseDuskInput(" 1000.5 ")).toBe(1_000_500_000_000n);
    expect(parseDuskInput(".000000001")).toBe(1n);
    expect(parseDuskInput("12.")).toBe(12n * DUSK);

    for (const text of ["", "1,000", "1e3", "-1", "1.0000000001", "abc"]) {
      expect(parseDuskInput(text)).toBeNull();
    }
  });
});

describe("normalizeDuskInput", () => {
  it("reads a decimal comma as a point, and leaves digit grouping out where it can't be decimals", () => {
    expect(normalizeDuskInput("1,5")).toBe("1.5");
    expect(normalizeDuskInput(" 0,25 ")).toBe("0.25");
    expect(normalizeDuskInput("0,123")).toBe("0.123");
    expect(normalizeDuskInput("1.000,5")).toBe("1000.5");
    expect(normalizeDuskInput("1,000.5")).toBe("1000.5");
    expect(normalizeDuskInput("1,000,000")).toBe("1000000");

    // A lone comma before three digits groups them, unless the language
    // writes decimals with a comma.
    expect(normalizeDuskInput("1,000")).toBe("1000");
    expect(normalizeDuskInput("1,000", ",")).toBe("1.000");

    // Anything else stays as typed, for the parser to refuse.
    for (const text of ["1,00,0", "1e3", "1.2.3", "abc", "1,5,"]) {
      expect(normalizeDuskInput(text)).toBe(text);
    }
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
    checkAmount({ ...base, amount: parseDuskInput(text), text, ...extra });

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

  it("caps an amount on its own, and then only the fee is paid from the balance", () => {
    const most = { amount: 5n * DUSK, error: "That's more than you have." };

    expect(check("6", { minimum: 0n, most }).error).toBe(
      "That's more than you have."
    );
    expect(check("ten", { minimum: 0n, most }).error).toBe(
      "Enter an amount such as 10 or 10.5."
    );
    expect(check("5", { available: 0n, minimum: 0n, most }).error).toBe(
      "The network fee is paid from the public balance, and it's empty."
    );
    expect(check("5", { available: 1n, minimum: 0n, most }).error).toBe(
      "The public balance doesn't cover the network fee."
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
  afterEach(() => {
    cleanup();
    baseProps.execute.mockClear();
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
    expect(getByRole("button", { name: "Stake" })).toBeDisabled();

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
    expect(getByRole("button", { name: "Stake 1,000.5 DUSK" })).toBeEnabled();
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
    await fireEvent.click(getByRole("button", { name: "Stake 10 DUSK" }));

    expect(baseProps.execute).toHaveBeenCalledWith(10n * DUSK, 1n, 50_000_000n);
  });

  it("fills in all of the public balance but the fee with Max", async () => {
    const { getByLabelText, getByRole } = render(NativeStake, baseProps);

    await fireEvent.click(getByRole("button", { name: "Max" }));

    expect(getByLabelText("Stake amount")).toHaveValue("1482.95");
    expect(getByRole("button", { name: "Stake 1,482.95 DUSK" })).toBeEnabled();
  });

  it("reviews the summary on its own page on phones, and goes back", async () => {
    const { container, getByLabelText, getByRole } = render(
      NativeStake,
      baseProps
    );
    const review = getByRole("button", { name: "Review" });

    expect(review).toBeDisabled();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "1000" },
    });
    await fireEvent.click(review);

    expect(container.querySelector(".stake-flow")).toHaveClass(
      "stake-flow--review"
    );

    await fireEvent.click(getByRole("button", { name: "Back" }));

    expect(container.querySelector(".stake-flow")).not.toHaveClass(
      "stake-flow--review"
    );
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
