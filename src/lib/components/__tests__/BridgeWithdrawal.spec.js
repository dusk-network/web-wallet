import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import bridgeTimes from "$lib/bridge/bridgeTimes";
import { resumeWithdrawalTracking } from "$lib/bridge/withdrawalActivity";
import { createCurrencyFormatter } from "$lib/dusk/currency";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import {
  cancelSendPassword,
  sendPasswordAsk,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import vault from "$lib/vault";

import { Bridge } from "..";
import { decodeFunctionData, parseAbi } from "viem";
import { networks } from "@dusk-network/networks";
import { duskRecipientOf } from "@dusk-network/networks/duskevm";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { PAID } from "$lib/bridge/__tests__/fixtures/withdrawal-recipient";

const mocks = vi.hoisted(() => ({
  estimateGas: vi.fn(
    /** @returns {Promise<bigint>} */ () =>
      Promise.reject(new Error("No estimate")),
  ),
  getGasPrice: vi.fn(async () => 1n),
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
  estimateGas: mocks.estimateGas,
  getGasPrice: mocks.getGasPrice,
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
    // Send takes a click half a second after it shows: on this clock.
    vi.useFakeTimers({ toFake: ["performance"] });
    setNodeNetwork(networks.testnet);
    mocks.sendTransaction.mockResolvedValue(`0x${"57".repeat(32)}`);
    mocks.switchChain.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("takes up tracking the connected wallet's withdrawals as it opens", () => {
    render(Bridge, props);

    expect(resumeWithdrawalTracking).toHaveBeenCalledWith(
      "0x2222222222222222222222222222222222222222",
    );
  });

  async function sendWithdrawal() {
    const rendered = render(Bridge, props);

    await fireEvent.click(
      rendered.getByRole("button", { name: "Swap From and To" }),
    );
    await fireEvent.input(rendered.getByRole("textbox"), {
      target: { value: "1" },
    });
    await fireEvent.click(
      rendered.getByRole("button", { name: "Review bridge" }),
    );
    await afterConfirmDelay();
    await fireEvent.click(rendered.getByRole("button", { name: "Send" }));

    return rendered;
  }

  it("takes no click on Send for half a second once the review shows, so a double click on Review can't send", async () => {
    const { getByRole } = render(Bridge, props);

    await fireEvent.click(getByRole("button", { name: "Swap From and To" }));
    await fireEvent.input(getByRole("textbox"), { target: { value: "1" } });
    await afterConfirmDelay();

    // Review's second click lands where Send now is, and so does Enter.
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await fireEvent.click(getByRole("button", { name: "Send" }));
    await fireEvent.click(getByRole("button", { name: "Send" }), {
      detail: 0,
    });
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
    await fireEvent.click(getByRole("button", { name: "Send" }));

    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Send" })).toBeEnabled();

    await vi.advanceTimersByTimeAsync(1);
    await fireEvent.click(getByRole("button", { name: "Send" }));

    await vi.waitFor(() =>
      expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
    );
  });

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

  // When it can be claimed after it's proved, and proved after it's sent:
  // none said where the chain doesn't say.
  it.each([
    [604_800, ["30 minutes", "7 days"]],
    [10_800, ["3 hours", "30 minutes"]],
    [null, []],
  ])(
    "says when to prove and claim on Dusk once sent, for a proof maturity of %s seconds",
    async (maturitySeconds, times) => {
      /** @type {any} */ (bridgeTimes).set(timesFor(maturitySeconds));

      const { container, findByRole } = await sendWithdrawal();

      // Sent: it can be tracked from here.
      await findByRole("link", { name: "Track withdrawal" });

      expect(
        (
          container.textContent?.match(/\d+ (?:days?|hours?|minutes?)\b/g) ?? []
        ).sort(),
      ).toStrictEqual(times);
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    },
  );

  it("sends the withdrawal on DuskEVM's bridge, from the connected address, paying the wallet's public account", async () => {
    /** @type {any} */ (bridgeTimes).set(timesFor(604_800));

    await sendWithdrawal();
    await vi.waitFor(() =>
      expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
    );

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

  /**
   * Waits for the failure screen, whatever it says.
   *
   * @param {import("@testing-library/svelte").RenderResult<any>} rendered
   */
  const failureShown = (rendered) =>
    vi.waitFor(() =>
      expect(
        rendered.container.querySelector(".dusk-error-alert"),
      ).not.toBeNull(),
    );

  it("offers to try again when DuskEVM couldn't be reached before the EVM wallet was asked to send it, and not after, as it may have gone out", async () => {
    mocks.switchChain.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const unreached = await sendWithdrawal();

    await failureShown(unreached);

    expect(mocks.sendTransaction).not.toHaveBeenCalled();

    await fireEvent.click(unreached.getByRole("button", { name: "Try again" }));

    expect(unreached.getByRole("heading", { name: "Review" })).toBeVisible();
    cleanup();

    mocks.sendTransaction.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    const rendered = await sendWithdrawal();

    await failureShown(rendered);

    expect(rendered.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  describe("the password on big sends", () => {
    const PASSWORD = "the password here";
    const PHRASE =
      "cat swing flag economy stadium alone churn speed unique patch report train";

    beforeEach(async () => {
      await vault.setUp(PHRASE, PASSWORD);
      setSendPasswordLimit(0n);
    });

    afterEach(async () => {
      cancelSendPassword();
      setSendPasswordLimit(null);
      await vault.clear();
    });

    it("asks before a withdrawal above the amount chosen, signed in the EVM wallet too, and nothing goes until it's given", async () => {
      await sendWithdrawal();
      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());

      expect(mocks.switchChain).not.toHaveBeenCalled();
      expect(mocks.sendTransaction).not.toHaveBeenCalled();

      await get(sendPasswordAsk)?.answer(PASSWORD);

      await vi.waitFor(() =>
        expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
      );
    });

    describe("with the fee counted, in DUSK as it's paid", () => {
      const AMOUNT = 1_000_000_000n;
      const RESERVE = 10_000_000n;

      /**
       * Whether a withdrawal of 1 DUSK asks, with `limit` as the amount chosen:
       * asking shows before anything's asked of the EVM wallet.
       *
       * @param {bigint} limit
       */
      async function asksAt(limit) {
        setSendPasswordLimit(limit);
        await sendWithdrawal();
        await vi.waitFor(() =>
          expect(
            get(sendPasswordAsk) ?? mocks.sendTransaction.mock.calls[0],
          ).toBeTruthy(),
        );

        const asked = get(sendPasswordAsk) !== null;

        cancelSendPassword();
        cleanup();
        mocks.sendTransaction.mockClear();

        return asked;
      }

      it("asks for an amount at the limit, as the fee takes it above that", async () => {
        expect(await asksAt(AMOUNT)).toBe(true);
      });

      it("goes by the most a fee is taken to be with no estimate, as Max does", async () => {
        expect(await asksAt(AMOUNT + RESERVE - 1n)).toBe(true);
        expect(await asksAt(AMOUNT + RESERVE)).toBe(false);
      });

      it("goes by twice the estimate, in whole lux, as the EVM wallet sets what it pays", async () => {
        // 0.02 DUSK and a wei: twice that is above what's taken with no estimate.
        mocks.estimateGas.mockResolvedValue(20_000_000_000_000_001n);

        try {
          expect(await asksAt(AMOUNT + 40_000_000n)).toBe(true);
          expect(await asksAt(AMOUNT + 40_000_001n)).toBe(false);
        } finally {
          mocks.estimateGas.mockReset();
          mocks.estimateGas.mockRejectedValue(new Error("No estimate"));
        }
      });
    });

    it("sends nothing when it isn't given, and offers to try again", async () => {
      const rendered = await sendWithdrawal();

      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());
      get(sendPasswordAsk)?.cancel();

      await failureShown(rendered);

      expect(rendered.getByRole("button", { name: "Try again" })).toBeVisible();
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
