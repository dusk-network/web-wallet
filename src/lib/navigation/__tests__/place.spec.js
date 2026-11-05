import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { ProfileGenerator } from "@dusk/w3sper";

import {
  Allocate,
  LiquidStake,
  NativeStake,
  Send,
  Unstake,
} from "$lib/components";
import { afterConfirmDelay, getAsHTMLElement } from "$lib/dusk/test-helpers";
import { networkStore, settingsStore, walletStore } from "$lib/stores";
import { openTestContacts, stubWalletNetwork } from "$lib/test-helpers";
import { outcomeUnknown } from "$lib/transactions";
import { generateMnemonic, getSeedFromMnemonic } from "$lib/wallet";

// The accounts here are made up, so none is a key.
vi.mock("@dusk-network/networks/account", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  isAccount: vi.fn(() => true),
}));

// Each profile its own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

// The transaction sent stays pending.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  followTransaction,
}));

// How the page came to be: Back or Forward, or a link.
const nav = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  navigating: null,
}));

vi.mock("$app/stores", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  nav.navigating = writable(null);

  return {
    .../** @type {object} */ (await importOriginal()),
    navigating: nav.navigating,
  };
});

const DUSK = 1_000_000_000n;
const HASH = "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";
const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
const RECIPIENT =
  "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const RECIPIENT_SHIELDED =
  "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnM";

/**
 * Whether this tab holds what was typed in any form, as anyone could read it.
 *
 * @param {string} typed
 */
const isKept = (typed) =>
  Object.values({ ...sessionStorage }).some((held) =>
    JSON.stringify(JSON.parse(held)?.values ?? null).includes(typed)
  );

const seed = getSeedFromMnemonic(generateMnemonic());
const generator = new ProfileGenerator(async () => seed);

/** The wallet opens, as it does on unlocking. */
const open = () => walletStore.init(generator);

/**
 * A lock or a reload: the wallet goes before what shows it, then it opens as
 * an unlock opens it.
 */
async function lockAndUnlock() {
  walletStore.reset();
  cleanup();
  await open();
}

/**
 * The other profile from the top bar, with nothing typed since, then a lock or
 * a reload, which comes back to that profile.
 */
async function switchProfileAndUnlock() {
  await walletStore.setCurrentProfile(get(walletStore).profiles[1]);
  walletStore.reset();
  cleanup();
  await walletStore.init(generator, undefined, { profile: 1 });
}

/** Leaving the page in the wallet: the wallet stays open. */
const leave = cleanup;

describe("Keeping what's typed in a form that moves money", () => {
  stubWalletNetwork();

  beforeAll(() => openTestContacts());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    await open();
  });

  afterEach(() => {
    cleanup();
    walletStore.reset();
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("Send", () => {
    const sendProps = {
      availableBalance: 1_000n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      publicAddress: "own-public-account",
      resolveName: vi.fn(),
      shieldedAddress: "own-shielded-address",
      shieldedBalance: 500n * DUSK,
    };

    /** @param {{ initialRecipient?: string }} [props] */
    async function typedForm(props) {
      const view = render(Send, { ...sendProps, ...props });

      await fireEvent.input(view.getByRole("textbox", { name: "To" }), {
        target: { value: RECIPIENT },
      });
      await fireEvent.input(view.getByRole("textbox", { name: "Amount" }), {
        target: { value: "2,5" },
      });
      await fireEvent.input(view.getByRole("textbox", { name: /^Memo/ }), {
        target: { value: "Invoice 118" },
      });

      return view;
    }

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const fields = ({ getByRole }) => [
      getByRole("textbox", { name: "To" }),
      getByRole("textbox", { name: "Amount" }),
      getByRole("textbox", { name: /^Memo/ }),
    ];

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const expectTyped = (view) => {
      const [to, amount, memo] = fields(view);

      expect(to).toHaveValue(RECIPIENT);
      expect(amount).toHaveValue("2,5");
      expect(memo).toHaveValue("Invoice 118");
    };

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const expectBlank = (view) => {
      const [to, amount, memo] = fields(view);

      expect(to).toHaveValue("");
      expect(amount).toHaveValue("");
      expect(memo).toHaveValue("");
    };

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    async function press({ getByRole }) {
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: /^Send/ }));
    }

    afterEach(() => {
      sendProps.execute.mockClear();
    });

    it("brings back the address, the amount and the memo after a lock or a reload, as a form to review, with nothing sent", async () => {
      const typed = await typedForm();

      await fireEvent.click(typed.getByRole("button", { name: "Review" }));
      await lockAndUnlock();

      const back = render(Send, sendProps);

      expectTyped(back);
      expect(back.container.querySelector(".send")).not.toHaveClass(
        "send--review"
      );
      expect(sendProps.execute).not.toHaveBeenCalled();
    });

    it("keeps none of it once it goes out, while it's on its way, so that a reload can't send it twice", async () => {
      sendProps.execute.mockReturnValueOnce(new Promise(() => {}));

      await press(await typedForm());

      expect(isKept(RECIPIENT)).toBe(false);
      expect(isKept("Invoice 118")).toBe(false);

      await lockAndUnlock();

      expectBlank(render(Send, sendProps));
    });

    it("keeps none of it once it went out", async () => {
      const sent = await typedForm();

      await press(sent);
      await vi.waitFor(() => expect(sent.getByRole("status")).toBeVisible());

      expect(isKept(RECIPIENT)).toBe(false);

      leave();

      expectBlank(render(Send, sendProps));
    });

    it("brings it back after a send that failed with nothing sent, also after leaving the page, and a reload", async () => {
      sendProps.execute.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const failed = await typedForm();

      await press(failed);
      await failed.findByRole("button", { name: "Try again" });

      // Home, from the screen that says it failed.
      leave();

      const back = render(Send, sendProps);

      expectTyped(back);

      await lockAndUnlock();

      expectTyped(render(Send, sendProps));
    });

    it("lets it go once the form brought back is left", async () => {
      sendProps.execute.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const failed = await typedForm();

      await press(failed);
      await failed.findByRole("button", { name: "Try again" });
      leave();
      render(Send, sendProps);
      leave();

      expectBlank(render(Send, sendProps));
    });

    it("keeps none of it after a send that may have gone out", async () => {
      sendProps.execute.mockRejectedValueOnce(
        outcomeUnknown(new TypeError("Failed to fetch"))
      );

      const failed = await typedForm();

      await press(failed);
      await failed.findByText("Not confirmed");

      expect(isKept(RECIPIENT)).toBe(false);

      leave();

      expectBlank(render(Send, sendProps));
    });

    it("keeps it again from Try again on, and lets it go as it's sent", async () => {
      sendProps.execute.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const failed = await typedForm();

      await press(failed);
      await fireEvent.click(
        await failed.findByRole("button", { name: "Try again" })
      );

      expect(isKept(RECIPIENT)).toBe(true);

      await afterConfirmDelay();
      await fireEvent.click(failed.getByRole("button", { name: /^Send/ }));

      expect(isKept(RECIPIENT)).toBe(false);
    });

    it("brings it back with the browser's Back after leaving the page in the wallet, but not with a link there", async () => {
      await typedForm();
      leave();

      nav.navigating?.set({ type: "popstate" });

      const back = render(Send, sendProps);

      nav.navigating?.set(null);
      expectTyped(back);

      // Left again, and back by a link: a new form.
      leave();
      nav.navigating?.set({ type: "link" });

      const fresh = render(Send, sendProps);

      nav.navigating?.set(null);
      expectBlank(fresh);

      // And Back can't find it after that.
      leave();
      nav.navigating?.set({ type: "popstate" });

      const after = render(Send, sendProps);

      nav.navigating?.set(null);
      expectBlank(after);
    });

    it("brings nothing back with Back once it went out", async () => {
      const typed = await typedForm();

      await press(typed);

      expect(isKept(RECIPIENT)).toBe(false);

      leave();
      nav.navigating?.set({ type: "popstate" });

      const back = render(Send, sendProps);

      nav.navigating?.set(null);
      expectBlank(back);
    });

    it("lets it go as the page is left in the wallet, as it was", async () => {
      await typedForm();
      leave();

      expectBlank(render(Send, sendProps));
    });

    it("keeps it only for the wallet, profile and network it was typed on", async () => {
      await typedForm();
      walletStore.reset();
      cleanup();
      await walletStore.init(generator, undefined, { profile: 1 });

      expectBlank(render(Send, sendProps));
      cleanup();

      await typedForm();
      walletStore.reset();
      cleanup();
      await walletStore.init(generator, undefined, { key: "another" });

      expectBlank(render(Send, sendProps));
    });

    it("follows the profile the form moves to", async () => {
      const typed = await typedForm();
      const { profiles } = get(walletStore);

      await walletStore.setCurrentProfile(profiles[1]);
      await typed.rerender({ publicAddress: "own-other-account" });
      walletStore.reset();
      cleanup();
      await walletStore.init(generator, undefined, { profile: 1 });

      expectTyped(render(Send, sendProps));
    });

    it("leaves what a link names first, and comes back to it as typed", async () => {
      await typedForm();
      walletStore.reset();
      cleanup();
      await open();

      sendProps.resolveName.mockResolvedValue({
        error: "not-registered",
        name: "bob.dusk",
      });

      // A link to someone else, in the same tab.
      const linked = render(Send, {
        ...sendProps,
        initialRecipient: "bob.dusk",
      });

      expect(linked.getByRole("textbox", { name: "To" })).toHaveValue(
        "bob.dusk"
      );
      expect(linked.getByRole("textbox", { name: "Amount" })).toHaveValue("");
      cleanup();

      // Typed from that link, then a lock: the same link brings it back.
      const fromLink = await typedForm({ initialRecipient: "bob.dusk" });

      expect(fromLink.getByRole("textbox", { name: "To" })).toHaveValue(
        RECIPIENT
      );

      await lockAndUnlock();

      expectTyped(render(Send, { ...sendProps, initialRecipient: "bob.dusk" }));
      sendProps.resolveName.mockReset();
    });

    it("keeps Max's amount hidden with the balances, and edited gas, and which address of a name was picked", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      try {
        sendProps.resolveName.mockResolvedValue({
          account: RECIPIENT,
          address: RECIPIENT_SHIELDED,
          name: "alice.dusk",
        });

        const typed = render(Send, sendProps);

        await fireEvent.input(typed.getByRole("textbox", { name: "To" }), {
          target: { value: "alice.dusk" },
        });
        await fireEvent.click(
          await typed.findByRole("radio", { name: "Shielded address" })
        );
        await fireEvent.click(typed.getByRole("button", { name: "Max" }));
        await fireEvent.click(typed.getByRole("button", { name: "Edit" }));
        await fireEvent.input(typed.getByLabelText(/gas limit/i), {
          target: { value: "30000000" },
        });
        await lockAndUnlock();

        const back = render(Send, sendProps);

        expect(back.getByRole("textbox", { name: "Amount" })).toHaveValue(
          "••••"
        );
        expect(
          await back.findByRole("radio", { name: "Shielded address" })
        ).toBeChecked();
        expect(
          getAsHTMLElement(back.container, ".send__summary .gas-fee")
        ).toHaveTextContent("0.03 DUSK");
      } finally {
        settingsStore.update((store) => ({ ...store, hideBalances: false }));
        sendProps.resolveName.mockReset();
      }
    });

    it("keeps nothing that reads as a recovery phrase", async () => {
      const phrase = generateMnemonic();
      const typed = render(Send, sendProps);

      await fireEvent.input(typed.getByRole("textbox", { name: "Amount" }), {
        target: { value: "1" },
      });
      await fireEvent.input(typed.getByRole("textbox", { name: /^Memo/ }), {
        target: { value: phrase },
      });

      expect(isKept(phrase)).toBe(false);
      expect(isKept(phrase.split(" ")[0])).toBe(false);

      await lockAndUnlock();

      const back = render(Send, sendProps);

      expect(back.getByRole("textbox", { name: "Amount" })).toHaveValue("1");
      expect(back.getByRole("textbox", { name: /^Memo/ })).toHaveValue("");
    });
  });

  describe("native staking", () => {
    const stakeProps = {
      availableBalance: 2_000n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gasLimits: {
        gasLimitLower: 35_000_000n,
        gasLimitUpper: 1_000_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      minimumStake: 1_000n * DUSK,
      unstakeFee: 50_000_000n,
    };

    it("keeps what's typed through a switch of profile with the form still open, for the profile a lock comes back to", async () => {
      const typed = render(NativeStake, stakeProps);

      await fireEvent.input(typed.getByLabelText("Stake amount"), {
        target: { value: "1200" },
      });
      await switchProfileAndUnlock();

      expect(
        render(NativeStake, stakeProps).getByLabelText("Stake amount")
      ).toHaveValue("1200");
    });

    it("brings the amount back after a lock or a failed stake, and lets it go as it's staked", async () => {
      const typed = render(NativeStake, stakeProps);

      await fireEvent.input(typed.getByLabelText("Stake amount"), {
        target: { value: "1200" },
      });
      await lockAndUnlock();

      const back = render(NativeStake, stakeProps);

      expect(back.getByLabelText("Stake amount")).toHaveValue("1200");

      /** @type {PromiseWithResolvers<string>} */
      const sending = Promise.withResolvers();

      stakeProps.execute.mockReturnValueOnce(sending.promise);
      await fireEvent.click(back.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: /^Stake 1,200/ }));

      expect(isKept("1200")).toBe(false);

      sending.reject(new TypeError("Failed to fetch"));
      await back.findByRole("button", { name: "Try again" });

      expect(isKept("1200")).toBe(true);

      leave();

      const failed = render(NativeStake, stakeProps);

      expect(failed.getByLabelText("Stake amount")).toHaveValue("1200");

      await fireEvent.click(failed.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        failed.getByRole("button", { name: /^Stake 1,200/ })
      );
      leave();

      expect(
        render(NativeStake, stakeProps).getByLabelText("Stake amount")
      ).toHaveValue("");
    });
  });

  describe("liquid staking", () => {
    const status = {
      contracts: {
        hub: "aa".repeat(32),
        pool: POOL,
        stDusk: "dd".repeat(32),
        substrate: "cc".repeat(32),
      },
      error: "",
      fees: {
        deposit: { denominator: 400n, numerator: 1n },
        reward: { denominator: 100n, numerator: 15n },
      },
      flags: { maintenance: false, synchronization: false },
      pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
      position: { balance: 15n * DUSK, stDusk: 4n * DUSK },
      source: "hub",
    };
    const limits = {
      gasLimitLower: 2_500_000n,
      gasLimitUpper: 1_000_000_000n,
      gasPriceLower: 1n,
    };
    const liquidProps = {
      availableBalance: 172n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gas: {
        stake: { limits, settings: { gasLimit: 5_000_000n, gasPrice: 1n } },
        unstake: { limits, settings: { gasLimit: 10_000_000n, gasPrice: 1n } },
      },
      onRetry: vi.fn(),
      recheck: vi.fn(async () => status),
      sozu: { error: null, loading: false, status },
    };
    /** @type {any} */
    const liquidView = LiquidStake;

    it("keeps what's typed through a switch of profile with the form still open, for the profile a lock comes back to", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Stake amount"), {
        target: { value: "7" },
      });
      await switchProfileAndUnlock();

      expect(
        render(liquidView, liquidProps).getByLabelText("Stake amount")
      ).toHaveValue("7");
    });

    it("brings back each tab's amount and the tab it was on, and lets them go as one is sent", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Stake amount"), {
        target: { value: "7" },
      });
      await fireEvent.click(typed.getByRole("tab", { name: "Unstake" }));
      await fireEvent.input(typed.getByLabelText("Unstake amount"), {
        target: { value: "3" },
      });
      await lockAndUnlock();

      const back = render(liquidView, liquidProps);

      expect(back.getByLabelText("Unstake amount")).toHaveValue("3");

      await fireEvent.click(back.getByRole("tab", { name: "Stake" }));

      expect(back.getByLabelText("Stake amount")).toHaveValue("7");

      await fireEvent.click(back.getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(
        back.getByRole("button", { name: "Stake 7 DUSK with Sozu" })
      );
      await vi.waitFor(() => expect(liquidProps.execute).toHaveBeenCalled());

      expect(isKept("7")).toBe(false);
    });

    it("leaves it for a link to the other action", async () => {
      const typed = render(liquidView, liquidProps);

      await fireEvent.input(typed.getByLabelText("Stake amount"), {
        target: { value: "7" },
      });
      await lockAndUnlock();

      const linked = render(liquidView, {
        ...liquidProps,
        action: "unstake",
      });

      expect(linked.getByLabelText("Unstake amount")).toHaveValue("");
    });
  });

  describe("unstake and claim", () => {
    const unstakeProps = {
      availableBalance: 100n * DUSK,
      execute: vi.fn().mockResolvedValue(HASH),
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      maxWithdrawAmount: 278n * DUSK,
      minStakeRequirement: 1n * DUSK,
      operationCtaIconPath: "",
      operationCtaLabel: "Unstake",
      operationOverviewLabel: "Amount to unstake",
    };

    it("brings back an amount typed, not the one it starts with, and lets it go as it's sent", async () => {
      const typed = render(Unstake, unstakeProps);

      expect(isKept("278")).toBe(false);

      await fireEvent.input(typed.getByRole("textbox", { name: "Amount" }), {
        target: { value: "12" },
      });
      await lockAndUnlock();

      const back = render(Unstake, unstakeProps);

      expect(back.getByRole("textbox", { name: "Amount" })).toHaveValue("12");

      await fireEvent.click(back.getByRole("button", { name: "Next" }));
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Unstake" }));

      expect(unstakeProps.execute).toHaveBeenCalledOnce();
      expect(isKept("12")).toBe(false);
    });
  });

  describe("shield and unshield", () => {
    const allocateProps = {
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      shieldedAddress: "own-shielded-address",
      shieldedBalance: { spendable: 2_000n * DUSK, value: 2_000n * DUSK },
      unshieldedAddress: "own-public-account",
      unshieldedBalance: 1_000n * DUSK,
    };

    it("brings the amount back in the field it was typed in, the other worked out again, and lets it go as it's sent", async () => {
      const typed = render(Allocate, allocateProps);

      await fireEvent.input(
        typed.getByRole("textbox", { name: "Shielded amount" }),
        { target: { value: "2500" } }
      );
      await lockAndUnlock();

      const back = render(Allocate, allocateProps);

      expect(
        back.getByRole("textbox", { name: "Shielded amount" })
      ).toHaveValue("2500");
      expect(back.getByRole("textbox", { name: "Public amount" })).toHaveValue(
        "500"
      );

      const shield = vi
        .spyOn(walletStore, "shield")
        .mockReturnValue(new Promise(() => {}));

      await fireEvent.click(back.getByRole("button", { name: "Next" }));
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Send" }));

      expect(shield).toHaveBeenCalledOnce();
      expect(isKept("2500")).toBe(false);

      shield.mockRestore();
    });
  });

  it("goes by the network too", async () => {
    const stakeProps = {
      availableBalance: 2_000n * DUSK,
      execute: vi.fn(),
      gasLimits: {
        gasLimitLower: 35_000_000n,
        gasLimitUpper: 1_000_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 50_000_000n, gasPrice: 1n },
      minimumStake: 1_000n * DUSK,
      unstakeFee: 50_000_000n,
    };
    const typed = render(NativeStake, stakeProps);

    await fireEvent.input(typed.getByLabelText("Stake amount"), {
      target: { value: "1200" },
    });

    const networks = vi
      .spyOn(networkStore, "subscribe")
      .mockImplementation((run) => {
        run(/** @type {any} */ ({ networkName: "another network" }));

        return () => {};
      });

    await lockAndUnlock();

    expect(
      render(NativeStake, stakeProps).getByLabelText("Stake amount")
    ).toHaveValue("");

    networks.mockRestore();
  });
});
