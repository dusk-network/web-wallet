import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import DepositLifecycle from "../EvmTransactions/DepositLifecycle.svelte";

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: {
    blockExplorers: {
      default: { name: "Blockscout", url: "https://explorer.example.test" },
    },
  },
}));

vi.mock("$lib/bridge/bridgeTimes", () => ({
  default: {
    load: () => Promise.resolve(),
    /** @param {(value: any) => void} run */
    subscribe(run) {
      run({ chain: null, network: "testnet" });

      return () => {};
    },
  },
}));

/** A deposit on its way to DuskEVM. */
const deposit = () => ({
  account: null,
  amountWei: "250000000000000000",
  createdAt: Date.now() - 60_000,
  failureLayer: null,
  l1BlockHeight: 4_708_700,
  l1ConfirmedAt: Date.now() - 30_000,
  progressedAt: Date.now(),
  stage: "l2_pending",
  transactionHash: "ab".repeat(32),
});

describe("DepositLifecycle", () => {
  afterEach(cleanup);

  it("should head a deposit's steps with its amount and its state, as the Bridge shows it once sent", () => {
    const { getByRole, getByText } = render(DepositLifecycle, {
      deposit: deposit(),
    });

    expect(getByRole("heading", { name: "0.25 DUSK" })).toBeInTheDocument();
    expect(getByText("Bridging")).toBeInTheDocument();
    expect(
      getByRole("list", { name: "Bridge transaction progress" })
    ).toBeInTheDocument();
  });

  it("should leave the amount and the state to the row in a list that says them", () => {
    const { getByRole, queryByRole, queryByText } = render(DepositLifecycle, {
      deposit: deposit(),
      titled: false,
    });

    expect(queryByRole("heading")).toBeNull();
    expect(queryByText("Bridging")).toBeNull();
    expect(
      getByRole("list", { name: "Bridge transaction progress" })
    ).toBeInTheDocument();
  });
});
