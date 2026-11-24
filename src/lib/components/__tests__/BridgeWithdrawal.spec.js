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

import { account } from "$lib/web3/walletConnection";

import { Bridge } from "..";
import { decodeFunctionData, parseAbi } from "viem";
import { networks } from "@dusk-network/networks";
import { duskRecipientOf } from "@dusk-network/networks/duskevm";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { PAID } from "$lib/bridge/__tests__/fixtures/withdrawal-recipient";

const mocks = vi.hoisted(() => ({
  // DuskEVM testnet's GasPriceOracle: an L1 data fee of 379 wei at most, and
  // Jovian's operator fee, gas × 1,328,571,429 × 100 + 0.002 DUSK.
  call: vi.fn(async (_config, /** @type {{ data: `0x${string}` }} */ asked) => {
    const { decodeFunctionData, encodeAbiParameters, parseAbi } =
      await import("viem");
    const { args, functionName } = decodeFunctionData({
      abi: parseAbi([
        "function getL1FeeUpperBound(uint256) view returns (uint256)",
        "function getOperatorFee(uint256) view returns (uint256)",
      ]),
      data: asked.data,
    });

    return {
      data: encodeAbiParameters(
        [{ type: "uint256" }],
        [
          functionName === "getL1FeeUpperBound"
            ? 379n
            : BigInt(args[0]) * 1_328_571_429n * 100n + 2_000_000_000_000_000n,
        ],
      ),
    };
  }),
  // A withdrawal's gas on testnet.
  estimateGas: vi.fn(/** @returns {Promise<bigint>} */ async () => 138_463n),
  estimateMaxPriorityFeePerGas: vi.fn(async () => 1_000_000n),
  getBlock: vi.fn(async () => ({ baseFeePerGas: 10_000_000_000n })),
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

// The connected EVM account: another can be picked in the wallet meanwhile.
vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");

  return {
    account: writable({
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
  call: mocks.call,
  estimateGas: mocks.estimateGas,
  estimateMaxPriorityFeePerGas: mocks.estimateMaxPriorityFeePerGas,
  getBlock: mocks.getBlock,
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

/** The EVM account connected, and another the wallet can switch to. */
const CONNECTED = {
  address: "0x2222222222222222222222222222222222222222",
  chainId: 745,
  isConnected: true,
};
const OTHER_EVM = {
  ...CONNECTED,
  address: "0x3333333333333333333333333333333333333333",
};

/** Another profile's public account, which a withdrawal can pay. */
const OTHER_PROFILE =
  "u1PkM8xGkbjkgxQ4Dfy6nrkxheCwJtR5rkBTv2iZbThUyvRg3McBfJQeehP1RKNjnqTibwJHAGoZS2xyZ3YyyWbrByhQPFo11jzQPMhpNNNRiqM4YjK6jBHHe8B6zgz7NRA";

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
    /** @type {any} */ (account).set(CONNECTED);
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
    await fireEvent.click(rendered.getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(
      rendered.getByRole("button", { name: "Bridge 1 DUSK" }),
    );

    return rendered;
  }

  it("takes no click on Send for half a second once the review shows, so a double click on Review can't send", async () => {
    const { getByRole } = render(Bridge, props);

    await fireEvent.click(getByRole("button", { name: "Swap From and To" }));
    await fireEvent.input(getByRole("textbox"), { target: { value: "1" } });
    await afterConfirmDelay();

    // Review's second click lands where Send now is, and so does Enter.
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await fireEvent.click(getByRole("button", { name: "Bridge 1 DUSK" }));
    await fireEvent.click(getByRole("button", { name: "Bridge 1 DUSK" }), {
      detail: 0,
    });
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
    await fireEvent.click(getByRole("button", { name: "Bridge 1 DUSK" }));

    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Bridge 1 DUSK" })).toBeEnabled();

    await vi.advanceTimersByTimeAsync(1);
    await fireEvent.click(getByRole("button", { name: "Bridge 1 DUSK" }));

    await vi.waitFor(() =>
      expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
    );
  });

  /**
   * What the screen says to do next on Dusk once it's sent: prove, then
   * claim.
   *
   * @param {import("@testing-library/svelte").RenderResult<any>} sent
   */
  async function nextStepOf({ container, findByRole }) {
    // Sent: it can be tracked from here.
    await findByRole("link", { name: "Track withdrawal" });

    return container.querySelector(".operation-result p")?.textContent ?? "";
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

  // When it can be claimed after it's proved, and proved after it's sent,
  // each by its step: no time where the chain says none.
  it.each([
    [
      604_800,
      /\bclaim (?:about )?7 days after (?:you )?prov(?:e|ing)\b/i,
      /\bprove (?:about )?30 minutes after sending\b/i,
    ],
    [
      10_800,
      /\bclaim (?:about )?3 hours after (?:you )?prov(?:e|ing)\b/i,
      /\bprove (?:about )?30 minutes after sending\b/i,
    ],
  ])(
    "says when to prove and claim on Dusk once sent, for a proof maturity of %s seconds",
    async (maturitySeconds, claim, prove) => {
      /** @type {any} */ (bridgeTimes).set(timesFor(maturitySeconds));

      const sent = await sendWithdrawal();
      const next = await nextStepOf(sent);

      expect(next).toMatch(claim);
      expect(next).toMatch(prove);
      expect(mocks.sendTransaction).toHaveBeenCalledOnce();
    },
  );

  it("says no time to prove or claim on Dusk once sent where the chain says none", async () => {
    /** @type {any} */ (bridgeTimes).set(timesFor(null));

    const next = await nextStepOf(await sendWithdrawal());

    expect(next).toMatch(/\bprove\b/i);
    expect(next).toMatch(/\bclaim\b/i);
    expect(next).not.toMatch(/\d/);
    expect(mocks.sendTransaction).toHaveBeenCalledOnce();
  });

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

  // The quote the review shows, carried through it to the wallet's request:
  // DuskEVM's figures moving after it change nothing of what's asked.
  it("asks the EVM wallet for the gas limit and the price caps its review was quoted at, though DuskEVM's figures moved since", async () => {
    const rendered = render(Bridge, props);

    await fireEvent.click(
      rendered.getByRole("button", { name: "Swap From and To" }),
    );
    await fireEvent.input(rendered.getByRole("textbox"), {
      target: { value: "1" },
    });
    await fireEvent.click(rendered.getByRole("button", { name: "Review" }));
    await vi.waitFor(() =>
      expect(rendered.container).toHaveTextContent(/up to 0\.0274 DUSK/),
    );

    // Since: twice the gas, twice the base fee and a tip of 0.
    mocks.estimateGas.mockResolvedValue(276_926n);
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 20_000_000_000n });
    mocks.estimateMaxPriorityFeePerGas.mockResolvedValue(0n);

    try {
      await afterConfirmDelay();
      await fireEvent.click(
        rendered.getByRole("button", { name: "Bridge 1 DUSK" }),
      );
      await vi.waitFor(() =>
        expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
      );

      // The review's: from its account, the 138,463 estimated and a fifth
      // more, twice its base fee of 10 gwei and its tip of 0.001.
      expect(mocks.sendTransaction.mock.calls[0][1]).toMatchObject({
        account: CONNECTED.address,
        gas: 166_156n,
        maxFeePerGas: 20_001_000_000n,
        maxPriorityFeePerGas: 1_000_000n,
        value: 10n ** 18n,
      });
      // Quoted for that very call: from its account, to its contract, with
      // its data and its value.
      const sent = mocks.sendTransaction.mock.calls[0][1];

      expect(mocks.estimateGas).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        {
          account: CONNECTED.address,
          chainId: 745,
          data: sent.data,
          to: sent.to,
          value: sent.value,
        },
      );
    } finally {
      mocks.estimateGas.mockResolvedValue(138_463n);
      mocks.getBlock.mockResolvedValue({ baseFeePerGas: 10_000_000_000n });
      mocks.estimateMaxPriorityFeePerGas.mockResolvedValue(1_000_000n);
    }
  });

  it("sends nothing before the call's gas is estimated, nor where it can't be: no guess is sent as its limit", async () => {
    /** @type {PromiseWithResolvers<bigint>} */
    const estimate = Promise.withResolvers();

    mocks.estimateGas.mockReturnValueOnce(estimate.promise);

    const rendered = render(Bridge, props);
    const bridge = () =>
      rendered.getByRole("button", { name: "Bridge 1 DUSK" });

    await fireEvent.click(
      rendered.getByRole("button", { name: "Swap From and To" }),
    );
    await fireEvent.input(rendered.getByRole("textbox"), {
      target: { value: "1" },
    });
    await fireEvent.click(rendered.getByRole("button", { name: "Review" }));
    await afterConfirmDelay();

    // Its estimate under way: Bridge takes no press.
    expect(bridge()).toBeDisabled();
    expect(rendered.container).toHaveTextContent(
      /working out the network fee/i,
    );

    // It can't be estimated: still none, and why.
    estimate.reject(new Error("execution reverted"));

    await vi.waitFor(() =>
      expect(rendered.getByRole("alert")).toHaveTextContent(
        /couldn't work out the network fee/i,
      ),
    );

    expect(bridge()).toBeDisabled();
    expect(rendered.container).not.toHaveTextContent(/fee on DuskEVM, up to/i);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();

    // Read again: the fee, and Bridge once its press is due.
    await fireEvent.click(rendered.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() =>
      expect(rendered.container).toHaveTextContent(/up to 0\.0274 DUSK/),
    );
    await afterConfirmDelay();

    expect(bridge()).toBeEnabled();
  });

  it("works an amount Max filled in out again at its review's fee, where DuskEVM's base fee rose since, and sends what that whole fee leaves", async () => {
    const rendered = render(Bridge, {
      ...props,
      linkedRoute: "dusk-evm-to-dusk",
    });
    const field = rendered.getByRole("textbox");

    // At a base fee of 10 gwei, 0.027398298591693158 DUSK at most: Max
    // leaves that of the 3 DUSK.
    await fireEvent.click(rendered.getByRole("button", { name: "Max" }));
    await vi.waitFor(() => expect(field).toHaveValue("2.972601701"));

    // 11 gwei by Review: 0.027730610591693158 DUSK at most, which that
    // amount leaves too little for.
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 11_000_000_000n });

    try {
      await fireEvent.click(rendered.getByRole("button", { name: "Review" }));

      // Closed, the maximum at that fee in its place, for it to be reviewed.
      await vi.waitFor(() =>
        expect(rendered.getByRole("textbox")).toHaveValue("2.972269389"),
      );
      expect(rendered.queryByRole("heading", { name: "Review" })).toBeNull();
      expect(rendered.container).toHaveTextContent(
        /network fee went up, so Max is less now/i,
      );

      await fireEvent.click(rendered.getByRole("button", { name: "Review" }));
      await vi.waitFor(() =>
        expect(rendered.container).toHaveTextContent(/up to 0\.0278 DUSK/),
      );
      await afterConfirmDelay();
      await fireEvent.click(
        rendered.getByRole("button", { name: "Bridge 2.972269389 DUSK" }),
      );
      await vi.waitFor(() =>
        expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
      );

      // What goes and the most its fee can be come to no more than there is.
      const { gas, maxFeePerGas, value } =
        mocks.sendTransaction.mock.calls[0][1];
      const operatorFee = gas * 1_328_571_429n * 100n + 2_000_000_000_000_000n;

      expect(value).toBe(2_972_269_389_000_000_000n);
      expect(
        value + gas * maxFeePerGas + operatorFee + 2n * 379n,
      ).toBeLessThanOrEqual(3_000_000_000_000_000_000n);
    } finally {
      mocks.getBlock.mockResolvedValue({ baseFeePerGas: 10_000_000_000n });
    }
  });

  it("offers no Bridge where its review's fee leaves too little for an amount typed, and says so", async () => {
    const rendered = render(Bridge, {
      ...props,
      linkedRoute: "dusk-evm-to-dusk",
    });

    // 2.9726 DUSK fits beside the most its fee can be at 10 gwei, not at 11.
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 11_000_000_000n });

    try {
      await fireEvent.input(rendered.getByRole("textbox"), {
        target: { value: "2.9726" },
      });
      await fireEvent.click(rendered.getByRole("button", { name: "Review" }));
      await vi.waitFor(() =>
        expect(rendered.getByRole("alert")).toHaveTextContent(
          /not enough DUSK on DuskEVM for this and its network fee: you have 3 DUSK/i,
        ),
      );
      await afterConfirmDelay();

      expect(
        rendered.getByRole("button", { name: "Not enough DUSK" }),
      ).toBeDisabled();
      expect(rendered.queryByRole("button", { name: /^Bridge \d/ })).toBeNull();
      // What's typed stays: it's the person's.
      expect(rendered.container).toHaveTextContent(/2\.9726 DUSK/);
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    } finally {
      mocks.getBlock.mockResolvedValue({ baseFeePerGas: 10_000_000_000n });
    }
  });

  /**
   * Opens the review of a withdrawal of 1 DUSK, from the card as a link to
   * the route opens it, and waits for its fee.
   *
   * @param {Record<string, unknown>} [more] Props besides the card's own
   */
  async function reviewWithdrawal(more = {}) {
    const rendered = render(Bridge, {
      ...props,
      linkedRoute: "dusk-evm-to-dusk",
      ...more,
    });

    await fireEvent.input(rendered.getByRole("textbox"), {
      target: { value: "1" },
    });
    await fireEvent.click(rendered.getByRole("button", { name: "Review" }));

    return rendered;
  }

  /** @param {import("@testing-library/svelte").RenderResult<any>} rendered */
  const isReviewOpen = (rendered) =>
    rendered.queryByRole("heading", { name: "Review" }) !== null;

  // Each changes what the review would send: it closes, for that to be
  // reviewed, and nothing goes.
  it.each([
    [
      "the Bridge tab's link takes the card to the other route",
      (/** @type {any} */ rendered) => rendered.rerender({ linkedRoute: null }),
    ],
    [
      "another account is picked in the EVM wallet",
      () => /** @type {any} */ (account).set(OTHER_EVM),
    ],
    [
      "another profile is opened, which it would pay",
      (/** @type {any} */ rendered) =>
        rendered.rerender({
          unshieldedAccount: new Uint8Array(96).fill(1),
          unshieldedAddress: OTHER_PROFILE,
        }),
    ],
  ])("closes an open review once %s, and sends nothing", async (_, change) => {
    const rendered = await reviewWithdrawal();

    await vi.waitFor(() =>
      expect(rendered.container).toHaveTextContent(/up to 0\.0274 DUSK/),
    );
    expect(isReviewOpen(rendered)).toBe(true);

    await change(rendered);

    await vi.waitFor(() => expect(isReviewOpen(rendered)).toBe(false));
    expect(rendered.queryByRole("button", { name: /^Bridge \d/ })).toBeNull();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("closes a review still working out its fee once another profile is opened, and reviews the withdrawal to that one's account once asked again", async () => {
    /** @type {PromiseWithResolvers<bigint>} */
    const estimate = Promise.withResolvers();

    mocks.estimateGas.mockReturnValueOnce(estimate.promise);

    const rendered = await reviewWithdrawal();

    expect(rendered.container).toHaveTextContent(
      /working out the network fee/i,
    );

    await rendered.rerender({
      unshieldedAccount: new Uint8Array(96).fill(1),
      unshieldedAddress: OTHER_PROFILE,
    });

    // Closed, and the estimate asked for it, coming in late, is for none.
    await vi.waitFor(() => expect(isReviewOpen(rendered)).toBe(false));
    estimate.resolve(138_463n);
    await vi.waitFor(() => expect(mocks.estimateGas).toHaveBeenCalledOnce());
    expect(isReviewOpen(rendered)).toBe(false);

    // Asked again: the fee, and Bridge, for the profile open now.
    await fireEvent.click(rendered.getByRole("button", { name: "Review" }));
    await vi.waitFor(() =>
      expect(rendered.container).toHaveTextContent(/up to 0\.0274 DUSK/),
    );
    await afterConfirmDelay();
    await fireEvent.click(
      rendered.getByRole("button", { name: "Bridge 1 DUSK" }),
    );
    await vi.waitFor(() =>
      expect(mocks.sendTransaction).toHaveBeenCalledOnce(),
    );

    const [[, sent]] = mocks.sendTransaction.mock.calls;
    const { args } = decodeFunctionData({
      abi: parseAbi(["function bridgeETHTo(address, uint32, bytes)"]),
      data: sent.data,
    });

    expect(duskRecipientOf(args[2])).toStrictEqual({
      account: OTHER_PROFILE,
      kind: "account",
    });
  });

  it("empties an amount Max filled in once the Bridge tab's link takes the card to the other route, as the swap does", async () => {
    const rendered = render(Bridge, {
      ...props,
      linkedRoute: "dusk-evm-to-dusk",
    });

    await fireEvent.click(rendered.getByRole("button", { name: "Max" }));
    await vi.waitFor(() =>
      expect(rendered.getByRole("textbox")).not.toHaveValue(""),
    );

    // DuskEVM's balance's: nothing of it for a deposit from Dusk.
    await rendered.rerender({ linkedRoute: null });

    await vi.waitFor(() =>
      expect(rendered.getByRole("textbox")).toHaveValue(""),
    );
  });

  /**
   * The failure screen's heading and sentence, once it shows.
   *
   * @param {import("@testing-library/svelte").RenderResult<any>} rendered
   */
  async function failureOf(rendered) {
    await vi.waitFor(() =>
      expect(
        rendered.container.querySelector(".dusk-error-alert"),
      ).not.toBeNull(),
    );

    const alert = /** @type {HTMLElement} */ (
      rendered.container.querySelector(".dusk-error-alert")
    );

    return {
      heading:
        alert.querySelector(".dusk-error-alert__summary")?.textContent ?? "",
      sentence:
        alert.querySelector(".dusk-error-alert__description")?.textContent ??
        "",
    };
  }

  it("says to try again when DuskEVM couldn't be reached before the EVM wallet was asked to send it, and after, that it may have gone out", async () => {
    mocks.switchChain.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const unreached = await sendWithdrawal();
    const notSent = await failureOf(unreached);

    // Nothing went out.
    expect(notSent.heading).toBe("Not sent");
    expect(notSent.sentence).not.toMatch(/may have/i);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();

    await fireEvent.click(unreached.getByRole("button", { name: "Try again" }));

    expect(unreached.getByRole("heading", { name: "Review" })).toBeVisible();
    cleanup();

    mocks.sendTransaction.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    const rendered = await sendWithdrawal();
    const unknown = await failureOf(rendered);

    // It may have gone out: not confirmed, and nothing to send it again.
    expect(unknown.heading).toMatch(/not confirmed/i);
    expect(unknown.sentence).toMatch(/may have gone out/i);
    expect(unknown.sentence).toMatch(/check your EVM wallet/i);
    expect(unknown.sentence).not.toMatch(/nothing was sent|not sent/i);
    expect(unknown.heading).not.toMatch(/not sent/i);
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

      it("goes by the most the review quoted its fee at, in whole lux, as Max leaves", async () => {
        // 138,463 gas: 0.027398298591692779 DUSK at most, 27,398,299 lux.
        expect(await asksAt(AMOUNT + 27_398_298n)).toBe(true);
        expect(await asksAt(AMOUNT + 27_398_299n)).toBe(false);
      });
    });

    it("sends nothing where another EVM account was picked while it was asked, says so, and reviews it again from that one", async () => {
      const rendered = await sendWithdrawal();

      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());
      /** @type {any} */ (account).set(OTHER_EVM);
      await get(sendPasswordAsk)?.answer(PASSWORD);

      const notSent = await failureOf(rendered);

      expect(notSent.heading).toBe("Not sent");
      expect(notSent.sentence).toMatch(
        /EVM account or the profile changed after the review/i,
      );
      expect(mocks.sendTransaction).not.toHaveBeenCalled();

      // Again: a review of it from the account picked now.
      await fireEvent.click(
        rendered.getByRole("button", { name: "Try again" }),
      );

      expect(rendered.getByRole("heading", { name: "Review" })).toBeVisible();
      expect(rendered.container).toHaveTextContent(OTHER_EVM.address);
    });

    it("sends nothing when it isn't given, and offers to try again", async () => {
      const rendered = await sendWithdrawal();

      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());
      get(sendPasswordAsk)?.cancel();

      const notSent = await failureOf(rendered);

      expect(notSent.heading).toBe("Not sent");
      expect(notSent.sentence).not.toMatch(/may have/i);
      expect(rendered.getByRole("button", { name: "Try again" })).toBeVisible();
      expect(mocks.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
