import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import bridgeTimes from "$lib/bridge/bridgeTimes";
import { createCurrencyFormatter } from "$lib/dusk/currency";

import { Bridge } from "..";
import { decodeFunctionData, parseAbi } from "viem";
import { networks } from "@dusk-network/networks";
import { duskRecipientOf } from "@dusk-network/networks/duskevm";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { PAID } from "$lib/bridge/__tests__/fixtures/withdrawal-recipient";

const mocks = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  switchChain: vi.fn(),
}));

vi.mock("$lib/bridge/bridgeTimes", async () => {
  const { writable } = await import("svelte/store");
  const times = writable({});

  return {
    default: { load: vi.fn(), set: times.set, subscribe: times.subscribe },
  };
});

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
    // A testnet account: the withdrawal pays it.
    unshieldedAddress: PAID,
    unshieldedBalance: 1_000_000_000_000n,
  };

  beforeEach(() => {
    setNodeNetwork(networks.testnet);
    mocks.sendTransaction.mockResolvedValue(`0x${"57".repeat(32)}`);
    mocks.switchChain.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function sendWithdrawal() {
    const rendered = render(Bridge, props);

    await fireEvent.click(
      rendered.getByRole("button", { name: "Swap From and To" })
    );
    await fireEvent.input(rendered.getByRole("textbox"), {
      target: { value: "1" },
    });
    await fireEvent.click(
      rendered.getByRole("button", { name: "Review bridge" })
    );
    await fireEvent.click(rendered.getByRole("button", { name: "Send" }));

    return rendered;
  }

  /** @param {number | null} maturitySeconds */
  const timesFor = (maturitySeconds) => ({
    chain: maturitySeconds
      ? {
          withdrawal: {
            at: 1,
            finalitySeconds: 0,
            maturitySeconds,
            outputSeconds: 1_700,
          },
        }
      : null,
    network: "testnet",
  });

  it.each([
    [
      604_800,
      "Claim 7 days after you prove. You can prove about 30 minutes after sending.",
    ],
    [
      10_800,
      "Claim 3 hours after you prove. You can prove about 30 minutes after sending.",
    ],
    [null, "Prove it on Dusk, then claim it."],
  ])(
    "says what's left on Dusk once sent, for a proof maturity of %s seconds",
    async (maturitySeconds, line) => {
      /** @type {any} */ (bridgeTimes).set(timesFor(maturitySeconds));

      const { findByText } = await sendWithdrawal();

      expect(await findByText("Withdrawal sent")).toBeInTheDocument();
      expect(await findByText(line)).toBeInTheDocument();
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    }
  );

  it("sends the withdrawal on DuskEVM's bridge, from the connected address, paying the wallet's public account", async () => {
    /** @type {any} */ (bridgeTimes).set(timesFor(604_800));

    const { findByText } = await sendWithdrawal();

    expect(await findByText("Withdrawal sent")).toBeInTheDocument();

    const [[, sent]] = mocks.sendTransaction.mock.calls;
    const { args, functionName } = decodeFunctionData({
      abi: parseAbi(["function bridgeETHTo(address, uint32, bytes)"]),
      data: sent.data,
    });

    expect(sent).toMatchObject({
      chainId: 745,
      to: networks.testnet.duskEvm?.predeploys.l2StandardBridge,
      value: 10n ** 18n,
    });
    expect(functionName).toBe("bridgeETHTo");
    expect(args.slice(0, 2)).toStrictEqual([
      "0x2222222222222222222222222222222222222222",
      200_000,
    ]);
    expect(duskRecipientOf(args[2])).toStrictEqual({
      account: PAID,
      kind: "account",
    });
  });
});
