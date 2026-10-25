import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { createCurrencyFormatter } from "$lib/dusk/currency";

import { Bridge } from "..";

const mocks = vi.hoisted(() => ({
  loadWithdrawalWaitingPeriod: vi.fn(),
  sendTransaction: vi.fn(),
  switchChain: vi.fn(),
}));

vi.mock("$lib/web3/walletConnection", async () => {
  const { readable } = await import("svelte/store");

  return {
    account: readable({
      address: "0x2222222222222222222222222222222222222222",
      chainId: 745,
      isConnected: true,
    }),
    duskEvm: {
      blockExplorers: { default: { url: "https://explorer.example.test" } },
      id: 745,
      nativeCurrency: { decimals: 18 },
    },
    modal: { open: vi.fn() },
    wagmiConfig: {},
  };
});

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  sendTransaction: mocks.sendTransaction,
  switchChain: mocks.switchChain,
}));

vi.mock("$lib/bridge/withdrawalActivity", () => ({
  rememberWithdrawalTransaction: vi.fn((transactionHash) => ({
    transactionHash,
  })),
  resumeWithdrawalTracking: vi.fn(),
  trackWithdrawalTransaction: vi.fn(),
}));

vi.mock("$lib/bridge/withdrawalInitiation", () => ({
  prepareNativeDuskWithdrawalCall: () => ({
    data: "0x",
    to: "0x4200000000000000000000000000000000000010",
    value: 1_000_000_000_000_000_000n,
  }),
}));

vi.mock("$lib/bridge/withdrawals", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  loadWithdrawalWaitingPeriod: mocks.loadWithdrawalWaitingPeriod,
}));

describe("Bridge withdrawal", () => {
  const props = {
    evmDuskBalance: {
      decimals: 18,
      formatted: "3",
      symbol: "DUSK",
      value: 3_000_000_000_000_000_000n,
    },
    formatter: createCurrencyFormatter("en", "DUSK", 9),
    gasLimits: {
      gasLimitLower: 10000000n,
      gasLimitUpper: 1000000000n,
      gasPriceLower: 1n,
    },
    gasSettings: { gasLimit: 20000000n, gasPrice: 1n },
    unshieldedAccount: new Uint8Array(96),
    unshieldedAddress: "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2",
    unshieldedBalance: 1_000_000_000_000n,
  };

  beforeEach(() => {
    mocks.sendTransaction.mockResolvedValue(`0x${"57".repeat(32)}`);
    mocks.switchChain.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function sendWithdrawal() {
    const rendered = render(Bridge, props);
    const origin = /** @type {HTMLSelectElement} */ (
      rendered.container.querySelector("select[name='origin-network']")
    );

    await fireEvent.change(origin, { target: { value: "duskEvm" } });
    await fireEvent.input(rendered.getByRole("textbox"), {
      target: { value: "1" },
    });
    await fireEvent.click(rendered.getByRole("button", { name: "Next" }));
    await fireEvent.click(rendered.getByRole("button", { name: "SEND" }));

    return rendered;
  }

  it.each([
    [604_800n, "Two steps on Dusk, about 7 days in total."],
    [10_800n, "Two steps on Dusk, about 4 hours in total."],
    [null, "Two steps on Dusk, about 7 days in total."],
  ])(
    "says what's left on Dusk once sent, for a waiting period of %s seconds",
    async (waitingPeriod, line) => {
      mocks.loadWithdrawalWaitingPeriod.mockResolvedValue(waitingPeriod);

      const { findByText } = await sendWithdrawal();

      expect(await findByText("Withdrawal sent")).toBeInTheDocument();
      expect(await findByText(line)).toBeInTheDocument();
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    }
  );
});
