import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { ProfileGenerator } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";
import { tick } from "svelte";
import { get } from "svelte/store";

import { cardRoutes } from "$lib/bridge/cardRoutes";
import { formatDuskPlain } from "$lib/dusk/currency";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import { InvalidPasswordError } from "$lib/errors";
import {
  cancelSendPassword,
  sendPasswordAsk,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import { settingsStore, walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { routesStopped, stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { outcomeUnknown } from "$lib/transactions/outcomeUnknown";

import { Bridge } from "..";

const EVM = "0x2222222222222222222222222222222222222222";
const DUSK = 1_000_000_000n;
const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";

const mocks = vi.hoisted(() => ({
  account: /** @type {import("svelte/store").Writable<any> | null} */ (null),
  allowance: vi.fn(),
  approve: vi.fn(),
  followTransfers: vi.fn(async () => {}),
  transfers: /** @type {import("svelte/store").Writable<any[]> | null} */ (
    null
  ),
  executeSend: vi.fn(),
  followTransaction: vi.fn(() => new Promise(() => {})),
  getBalanceOfCoin: vi.fn(),
  getMigrationFee: vi.fn(async () => 120_000_000_000_000n),
  getNativeBalance: vi.fn(async () => DUSK * DUSK),
  getRevokeFee: vi.fn(async () => 24_222_000_387_552n),
  pushState: vi.fn(),
  migrate: vi.fn(),
  switchChain: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("$lib/bridge/bridgeTimes", async () => {
  const { readable } = await import("svelte/store");

  return {
    default: { load: vi.fn(), subscribe: readable({ chain: null }).subscribe },
  };
});

// The page's history state, as the tests move it.
vi.mock("$app/stores", async () => {
  const { readable, writable } = await import("svelte/store");

  // No navigation under way: a form left is left by a link.
  return { navigating: readable(null), page: writable({ state: {} }) };
});

vi.mock("$app/navigation", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  pushState: mocks.pushState,
}));

vi.mock("$lib/bridge/routeHistory", async () => {
  const { writable } = await import("svelte/store");

  mocks.transfers = writable([]);

  return { routeTransfers: mocks.transfers };
});

vi.mock("$lib/bridge/routeTracking", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  followTransfers: mocks.followTransfers,
}));

vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");

  mocks.account = writable({
    address: undefined,
    chainId: undefined,
    isConnected: false,
  });

  return {
    account: mocks.account,
    duskEvm: {
      blockExplorers: { default: { url: "https://explorer.example.test" } },
      id: 745,
      nativeCurrency: { decimals: 18 },
    },
    modal: { open: vi.fn() },
    wagmiConfig: {},
  };
});

vi.mock("@wagmi/core", async (importOriginal) => {
  const { get } = await import("svelte/store");

  return {
    .../** @type {object} */ (await importOriginal()),
    // The account as the page has it.
    getAccount: () => get(/** @type {any} */ (mocks.account)),
    switchChain: mocks.switchChain,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  };
});

vi.mock("$lib/web3/migration", () => ({
  allowance: mocks.allowance,
  approve: mocks.approve,
  getBalanceOfCoin: mocks.getBalanceOfCoin,
  getMigrationFee: mocks.getMigrationFee,
  getNativeBalance: mocks.getNativeBalance,
  getRevokeFee: mocks.getRevokeFee,
  migrate: mocks.migrate,
}));

vi.mock("$lib/contracts", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  executeSend: mocks.executeSend,
}));

// What the chain says of a transaction followed: nothing yet, unless a test
// says.
vi.mock("$lib/transactions", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  followTransaction: mocks.followTransaction,
}));

/** @param {Record<string, unknown>} value */
const connect = (value) => mocks.account?.set({ isConnected: true, ...value });

const props = {
  evmDuskBalance: undefined,
  gasLimits: {
    gasLimitLower: 2_000_000n,
    gasLimitUpper: 1_000_000_000n,
    gasPriceLower: 1n,
  },
  gasSettings: { gasLimit: 5_000_000n, gasPrice: 1n },
  transferGasLimits: {
    gasLimitLower: 2_000_000n,
    gasLimitUpper: 1_000_000_000n,
    gasPriceLower: 1n,
  },
  transferGasSettings: { gasLimit: 2_500_000n, gasPrice: 1n },
  unshieldedAccount: new Uint8Array(96),
  unshieldedAddress: ACCOUNT,
  unshieldedBalance: 10n * DUSK,
};

/**
 * Waits for the result to say it failed, whatever it says.
 *
 * @param {HTMLElement} container
 */
const failureShown = (container) =>
  vi.waitFor(() =>
    expect(container.querySelector(".dusk-error-alert")).not.toBeNull(),
  );

/**
 * What the card says where a screen reader hears it: its warnings and
 * refusals.
 *
 * @param {HTMLElement} container
 */
const said = (container) =>
  Array.from(
    container.querySelectorAll("[role=alert], [role=status]"),
    (region) => region.textContent?.trim(),
  ).filter(Boolean);

/** @param {HTMLElement} container */
const direction = (container) =>
  ["from", "to"].map((side) =>
    container
      .querySelector(`button[data-side='${side}']`)
      ?.getAttribute("data-value"),
  );

describe("the Bridge card's routes to and from other chains", () => {
  beforeEach(() => {
    // Send and Migrate take a click half a second after they show: on this
    // clock.
    vi.useFakeTimers({ toFake: ["performance"] });
    setNodeNetwork(networks.mainnet);
    mocks.account?.set({
      address: undefined,
      chainId: undefined,
      isConnected: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    settingsStore.update((store) => ({ ...store, hideBalances: false }));
  });

  it("hides what Max fills in on a route while balances are hidden, there and on its review", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      connect({ address: EVM, chainId: 1 });

      const { container, getByRole } = render(Bridge, props);
      const amount = /** @type {HTMLInputElement} */ (
        getByRole("textbox", { name: "Amount, in DUSK" })
      );

      await fireEvent.click(getByRole("button", { name: "Max" }));

      // The 10 DUSK less the fee, 9.9975, of which 8.9975 arrives: neither
      // said, in the field or what it gives.
      expect(amount.value).not.toMatch(/\d/);
      expect(container.querySelector("output")).not.toHaveTextContent(/\d/);

      await fireEvent.click(getByRole("button", { name: "Review bridge" }));

      expect(container).not.toHaveTextContent("9.9975");
      expect(container).not.toHaveTextContent("8.9975");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("hides what Max fills in on a migration while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      connect({ address: EVM, chainId: 56 });

      const { container, findByRole, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "bsc-to-dusk",
      });
      const amount = await findByRole("textbox", {
        name: "Amount, in BEP20 DUSK",
      });

      await vi.waitFor(() =>
        expect(getByRole("button", { name: "Max" })).toBeEnabled(),
      );
      await fireEvent.click(getByRole("button", { name: "Max" }));

      // The 5 BEP20 DUSK the wallet holds, said nowhere.
      expect(/** @type {HTMLInputElement} */ (amount).value).not.toMatch(/\d/);
      expect(container.querySelector("output")).not.toHaveTextContent(/\d/);

      // What hides it is no amount.
      await fireEvent.input(amount, { target: { value: "•••" } });

      expect(amount).toHaveValue("");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("takes no click on Send for half a second once the review shows, so a double click on Review can't send", async () => {
    connect({ address: EVM, chainId: 1 });

    const { getByRole } = render(Bridge, props);

    await fireEvent.input(getByRole("textbox", { name: "Amount, in DUSK" }), {
      target: { value: "2" },
    });
    await afterConfirmDelay();
    mocks.executeSend.mockResolvedValue("ab".repeat(32));

    // Review's second click lands where Send now is, and so does Enter.
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await fireEvent.click(getByRole("button", { name: "Send" }));
    await fireEvent.click(getByRole("button", { name: "Send" }), {
      detail: 0,
    });
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY - 1);
    await fireEvent.click(getByRole("button", { name: "Send" }));

    expect(mocks.executeSend).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Send" })).toBeEnabled();

    await vi.advanceTimersByTimeAsync(1);
    await fireEvent.click(getByRole("button", { name: "Send" }));

    expect(mocks.executeSend).toHaveBeenCalledOnce();
  });

  it("opens on mainnet on Dusk to BNB Smart Chain, which pays the connected wallet's address, never a typed one", async () => {
    const { container, getByRole, queryByRole } = render(Bridge, props);

    expect(direction(container)).toStrictEqual(["duskDs", "bsc"]);
    // No field for an address: it comes from the wallet.
    expect(queryByRole("textbox", { name: /address/i })).toBeNull();

    connect({ address: EVM, chainId: 1 });
    await tick();

    const amount = getByRole("textbox", { name: "Amount, in DUSK" });

    // No more than the bridge's fee: nothing would arrive.
    await fireEvent.input(amount, { target: { value: "1" } });

    expect(getByRole("button", { name: /1 DUSK/ })).toBeDisabled();

    await fireEvent.input(amount, { target: { value: "2" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    // 2 DUSK sent, the 1 DUSK fee, and 1 DUSK arriving on BNB Smart Chain at
    // the wallet's address.
    const line = container.querySelector(".route-review__line");

    expect(line).toHaveTextContent("2 DUSK");
    expect(line).toHaveTextContent("1 DUSK");
    expect(line).toHaveTextContent("BNB Smart Chain");
    expect(container).toHaveTextContent(EVM);

    mocks.executeSend.mockResolvedValue("ab".repeat(32));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Send" }));

    // A public transfer to the route's account, the address as the memo.
    expect(mocks.executeSend).toHaveBeenCalledWith(
      networks.mainnet.routes.services[0].account,
      2n * DUSK,
      EVM,
      1n,
      2_500_000n,
    );
  });

  it("migrates from BNB Smart Chain, as a link opens it: approves the exact amount when the contract may take less, then migrates to this account", async () => {
    const migration = networks.mainnet.routes.migrations[0];

    mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
    mocks.allowance.mockResolvedValue(0n);
    mocks.approve.mockResolvedValue(`0x${"aa".repeat(32)}`);
    mocks.migrate.mockResolvedValue(`0x${"bb".repeat(32)}`);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const { container, findByRole, getByRole } = render(Bridge, {
      ...props,
      linkedRoute: "bsc-to-dusk",
    });

    expect(direction(container)).toStrictEqual(["bsc", "duskDs"]);

    // On another chain, the wallet has to move to BNB Smart Chain first.
    connect({ address: EVM, chainId: 1 });
    await tick();

    expect(
      getByRole("button", { name: "Switch to BNB Smart Chain" }),
    ).toBeEnabled();

    connect({ address: EVM, chainId: 56 });

    const amount = await findByRole("textbox", {
      name: "Amount, in BEP20 DUSK",
    });

    expect(mocks.getBalanceOfCoin).toHaveBeenCalledWith(
      EVM,
      networks.mainnet.routes.chains.bsc.token,
      56,
    );

    await fireEvent.input(amount, { target: { value: "2,5" } });
    await fireEvent.click(getByRole("button", { name: "Review migration" }));

    expect(await findByRole("button", { name: "Migrate" })).toBeEnabled();
    // The amount, from the wallet on BNB Smart Chain to this public account.
    expect(container).toHaveTextContent("2.5 DUSK");
    expect(container).toHaveTextContent("BNB Smart Chain");
    expect(container).toHaveTextContent(EVM);
    expect(container).toHaveTextContent(ACCOUNT);

    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Migrate" }));
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

    const wei = 2_500_000_000n * DUSK;

    expect(mocks.approve).toHaveBeenCalledWith(
      migration.contract,
      networks.mainnet.routes.chains.bsc.token,
      wei,
      56,
      EVM,
    );
    expect(mocks.migrate).toHaveBeenCalledWith(
      wei,
      56,
      ACCOUNT,
      migration.contract,
      EVM,
    );
    // Kept for Bridge › Activity until it's paid.
    expect(
      JSON.parse(localStorage.getItem("web-wallet-migrations") ?? "[]"),
    ).toMatchObject([
      { amountLux: String(2_500_000_000n), hash: `0x${"bb".repeat(32)}` },
    ]);
  });

  it("migrates without an approval when the contract may take the amount already", async () => {
    mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
    mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
    mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    connect({ address: EVM, chainId: 1 });

    const { findByRole, getByRole } = render(Bridge, {
      ...props,
      linkedRoute: "ethereum-to-dusk",
    });

    await fireEvent.input(
      await findByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
      { target: { value: "1" } },
    );
    await fireEvent.click(getByRole("button", { name: "Review migration" }));
    await findByRole("button", { name: "Migrate" });
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Migrate" }));
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

    expect(mocks.approve).not.toHaveBeenCalled();
  });

  describe("keeping what's typed", () => {
    const seed = new Uint8Array(64).fill(3);
    const generator = new ProfileGenerator(async () => seed);

    /** A lock or a reload: the wallet goes before what shows it. */
    async function lockAndUnlock() {
      walletStore.reset();
      cleanup();
      await walletStore.init(generator);
    }

    beforeEach(async () => {
      stubWalletNetwork();
      await walletStore.init(generator);
    });

    afterEach(() => {
      cleanup();
      walletStore.reset();
    });

    it("brings back a transfer out's amount after a lock, and lets it go as it's sent", async () => {
      connect({ address: EVM, chainId: 1 });

      const typed = render(Bridge, props);

      await fireEvent.input(
        typed.getByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } },
      );
      await lockAndUnlock();

      const back = render(Bridge, props);

      expect(
        back.getByRole("textbox", { name: "Amount, in DUSK" }),
      ).toHaveValue("2");

      mocks.executeSend.mockReturnValue(new Promise(() => {}));
      await fireEvent.click(
        back.getByRole("button", { name: "Review bridge" }),
      );
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Send" }));
      await lockAndUnlock();

      expect(
        render(Bridge, props).getByRole("textbox", { name: "Amount, in DUSK" }),
      ).toHaveValue("");
    });

    it("brings it back after a transfer out that failed with nothing sent, not after one that may have gone out", async () => {
      connect({ address: EVM, chainId: 1 });

      /** @param {Error} failure */
      async function failWith(failure) {
        mocks.executeSend.mockRejectedValueOnce(failure);

        const view = render(Bridge, props);

        await fireEvent.input(
          view.getByRole("textbox", { name: "Amount, in DUSK" }),
          { target: { value: "2" } },
        );
        await fireEvent.click(
          view.getByRole("button", { name: "Review bridge" }),
        );
        await afterConfirmDelay();
        await fireEvent.click(view.getByRole("button", { name: "Send" }));

        return view;
      }

      const failed = await failWith(new TypeError("Failed to fetch"));

      await failed.findByRole("button", { name: "Try again" });
      cleanup();

      expect(
        render(Bridge, props).getByRole("textbox", { name: "Amount, in DUSK" }),
      ).toHaveValue("2");
      cleanup();

      const unknown = await failWith(
        outcomeUnknown(new TypeError("Failed to fetch")),
      );

      await failureShown(unknown.container);
      cleanup();

      expect(
        render(Bridge, props).getByRole("textbox", { name: "Amount, in DUSK" }),
      ).toHaveValue("");
    });

    it("brings back a migration's route and amount after a lock, and lets it go as it's sent", async () => {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockReturnValue(new Promise(() => {}));
      connect({ address: EVM, chainId: 56 });

      const opened = { ...props, linkedRoute: "bsc-to-dusk" };
      const typed = render(Bridge, opened);

      await fireEvent.input(
        await typed.findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "1,5" } },
      );
      await lockAndUnlock();

      const back = render(Bridge, opened);
      const amount = await back.findByRole("textbox", {
        name: "Amount, in BEP20 DUSK",
      });

      expect(amount).toHaveValue("1,5");

      await vi.waitFor(() => expect(amount).toBeEnabled());
      await fireEvent.click(
        back.getByRole("button", { name: "Review migration" }),
      );
      await back.findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Migrate" }));
      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());
      await lockAndUnlock();

      expect(
        await render(Bridge, opened).findByRole("textbox", {
          name: "Amount, in BEP20 DUSK",
        }),
      ).toHaveValue("");
    });
  });

  describe("the password on big sends", () => {
    const PASSWORD = "the password here";
    const PHRASE =
      "cat swing flag economy stadium alone churn speed unique patch report train";

    beforeEach(async () => {
      await vault.setUp(PHRASE, PASSWORD);
      setSendPasswordLimit(DUSK);
    });

    afterEach(async () => {
      cancelSendPassword();
      setSendPasswordLimit(null);
      await vault.clear();
    });

    /** The review of a migration of `value` DUSK, ready to be sent. */
    async function migrationOf(/** @type {string} */ value) {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      connect({ address: EVM, chainId: 56 });

      const view = render(Bridge, { ...props, linkedRoute: "bsc-to-dusk" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value } },
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review migration" }),
      );
      await view.findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();
      await fireEvent.click(view.getByRole("button", { name: "Migrate" }));

      return view;
    }

    it("asks before a migration above the amount chosen, signed in the EVM wallet too, and nothing goes until it's given", async () => {
      await migrationOf("2");
      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());

      expect(mocks.allowance).toHaveBeenCalled();
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(mocks.approve).not.toHaveBeenCalled();

      await expect(get(sendPasswordAsk)?.answer("wrong")).rejects.toThrow(
        InvalidPasswordError,
      );

      expect(mocks.migrate).not.toHaveBeenCalled();

      await get(sendPasswordAsk)?.answer(PASSWORD);

      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalledOnce());
    });

    it("goes back to the review when it isn't given, with nothing moved", async () => {
      const { findByRole } = await migrationOf("2");

      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());
      get(sendPasswordAsk)?.cancel();

      expect(await findByRole("alert")).toBeInTheDocument();
      expect(await findByRole("button", { name: "Migrate" })).toBeVisible();
      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("asks nothing up to the amount chosen", async () => {
      await migrationOf("1");

      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalledOnce());
      expect(get(sendPasswordAsk)).toBeNull();
    });
  });

  describe("an approval not used up", () => {
    const BSC = networks.mainnet.routes.chains.bsc;
    const BSC_CONTRACT = /** @type {any} */ (
      networks.mainnet.routes.migrations.find((m) => m.chain === "bsc")
    ).contract;

    /** Half a DUSK in wei, as an approval of 1 leaves it once 0.5 went. */
    const HALF = 500_000_000n * DUSK;

    /** The way back, connected on its chain, its allowance read on the chain. */
    function openRoute() {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      connect({ address: EVM, chainId: 56 });

      return render(Bridge, { ...props, linkedRoute: "bsc-to-dusk" });
    }

    /** @param {Element} container */
    const panel = (container) => container.querySelector(".route-approval");

    it("shows on the form what the contract may still take, as the chain says, with Finish and Revoke", async () => {
      mocks.allowance.mockResolvedValue(HALF);

      const { container, findByRole, getByRole } = openRoute();

      expect(await findByRole("button", { name: "Revoke" })).toBeEnabled();
      expect(getByRole("button", { name: "Finish" })).toBeEnabled();
      expect(panel(container)).toHaveTextContent("0.5 BEP20 DUSK");
      expect(mocks.allowance).toHaveBeenCalledWith(
        EVM,
        BSC.token,
        BSC_CONTRACT,
        56,
      );
      // Nothing of it is kept here.
      expect(
        Object.keys(localStorage).filter((key) => /approv/i.test(key)),
      ).toStrictEqual([]);
    });

    it("hides the amount with the balances, and offers to revoke one with no limit", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      mocks.allowance.mockResolvedValue(HALF);

      const hidden = openRoute();

      await hidden.findByRole("button", { name: "Revoke" });

      expect(panel(hidden.container)).not.toHaveTextContent("0.5");
      cleanup();
      settingsStore.update((store) => ({ ...store, hideBalances: false }));

      mocks.allowance.mockResolvedValue(2n ** 256n - 1n);

      const unlimited = openRoute();

      expect(
        await unlimited.findByRole("button", { name: "Revoke" }),
      ).toBeEnabled();
    });

    it("finishes on the review with what the approval still lets go, which says it's approved already", async () => {
      mocks.allowance.mockResolvedValue(HALF);
      mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);

      const { container, findByRole, getByRole } = openRoute();

      await fireEvent.click(await findByRole("button", { name: "Finish" }));

      await findByRole("heading", { name: "Review" });
      await vi.waitFor(() =>
        expect(getByRole("button", { name: "Migrate" })).toBeEnabled(),
      );
      expect(container.querySelector(".review-amount")).toHaveTextContent(
        "0.5 DUSK",
      );
      // The earlier approval that covers it.
      expect(container).toHaveTextContent("0.5 BEP20 DUSK");

      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

      expect(mocks.approve).not.toHaveBeenCalled();
      expect(mocks.migrate.mock.calls[0][0]).toBe(HALF);
    });

    it("finishes with no more than the wallet holds, and doesn't offer it with nothing to finish it with", async () => {
      mocks.allowance.mockResolvedValue(10n * DUSK * DUSK);

      const more = openRoute();

      await fireEvent.click(
        await more.findByRole("button", { name: "Finish" }),
      );
      await more.findByRole("heading", { name: "Review" });

      expect(more.container.querySelector(".review-amount")).toHaveTextContent(
        "5 DUSK",
      );
      cleanup();

      mocks.getBalanceOfCoin.mockResolvedValue(0n);
      connect({ address: EVM, chainId: 56 });

      const empty = render(Bridge, { ...props, linkedRoute: "bsc-to-dusk" });

      await empty.findByRole("button", { name: "Revoke" });

      expect(empty.queryByRole("button", { name: "Finish" })).toBeNull();
    });

    it("says on a review that skips the approval what covers it and what stays approved", async () => {
      mocks.allowance.mockResolvedValue(HALF);

      const { container, findByRole, getByRole } = openRoute();

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "0.2" } },
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await vi.waitFor(() =>
        expect(getByRole("button", { name: "Migrate" })).toBeEnabled(),
      );

      // The 0.5 approved covers the 0.2, and 0.3 stays approved.
      expect(container).toHaveTextContent("0.5 BEP20 DUSK");
      expect(container).toHaveTextContent("0.3 BEP20 DUSK");
    });

    it("hides what an approval leaves on the review with the balances", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      mocks.allowance.mockResolvedValue(HALF);

      const { container, findByRole, getByRole } = openRoute();

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "0.2" } },
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await vi.waitFor(() =>
        expect(getByRole("button", { name: "Migrate" })).toBeEnabled(),
      );

      expect(container).not.toHaveTextContent("0.3 BEP20");
      expect(container).not.toHaveTextContent("0.5 BEP20");
    });

    describe("Revoke", () => {
      /** The review of a revoke, from the form's Revoke, able to take a click. */
      async function toRevoke() {
        const view = openRoute();

        await fireEvent.click(
          await view.findByRole("button", { name: "Revoke" }),
        );
        await view.findByRole("heading", { name: "Review" });
        await afterConfirmDelay();

        return view;
      }

      /** The review's button, which asks the EVM wallet to sign the revoke. */
      const revokeIn = (/** @type {any} */ { getByRole }) =>
        getByRole("button", { name: "Revoke in your wallet" });

      it("is reviewed first, as the standalone's: what's approved now, from where, what it costs, and that nothing moves, with Back", async () => {
        mocks.allowance.mockResolvedValue(HALF);

        const view = openRoute();

        await fireEvent.click(
          await view.findByRole("button", { name: "Revoke" }),
        );

        const review = /** @type {HTMLElement} */ (
          (await view.findByRole("heading", { name: "Review" })).parentElement
        );

        expect(mocks.approve).not.toHaveBeenCalled();
        // What's approved now, from which wallet on which chain.
        expect(review).toHaveTextContent("0.5 BEP20 DUSK");
        expect(review).toHaveTextContent("BNB Smart Chain");
        expect(review).toHaveTextContent(EVM);
        // What it costs, from what the wallet holds.
        await vi.waitFor(() =>
          expect(review).toHaveTextContent("0.000024 BNB"),
        );
        expect(review).toHaveTextContent("1 BNB");
        expect(mocks.getRevokeFee).toHaveBeenCalledWith({
          chainId: 56,
          migrationContract: BSC_CONTRACT,
          owner: EVM,
          stableCoinAddress: BSC.token,
        });

        // Back to the form, with nothing asked of the wallet.
        await fireEvent.click(view.getByRole("button", { name: "Back" }));

        expect(view.queryByRole("heading", { name: "Review" })).toBeNull();
        expect(panel(view.container)).toHaveTextContent("0.5 BEP20 DUSK");
        expect(mocks.approve).not.toHaveBeenCalled();
      });

      it("is a transaction the EVM wallet signs, approving nothing, and the form then reads the chain again", async () => {
        mocks.allowance.mockResolvedValue(HALF);
        mocks.approve.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          return `0x${"dd".repeat(32)}`;
        });

        const view = await toRevoke();
        const { container, findByRole, queryByRole } = view;

        await fireEvent.click(revokeIn(view));

        // Back on the form, which says so.
        expect(await findByRole("alert")).toBeInTheDocument();
        expect(queryByRole("heading", { name: "Review" })).toBeNull();
        expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(
          BSC_CONTRACT,
          BSC.token,
          0n,
          56,
          EVM,
        );
        expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(
          {},
          { chainId: 56, hash: `0x${"dd".repeat(32)}` },
        );
        await vi.waitFor(() => expect(panel(container)).toBeNull());
        expect(queryByRole("button", { name: "Revoke" })).toBeNull();
      });

      it("takes no second press while it waits for the wallet, then the chain", async () => {
        /** @type {(hash: string) => void} */
        let signed = () => {};

        mocks.allowance.mockResolvedValue(HALF);
        mocks.approve.mockReturnValue(
          new Promise((resolve) => {
            signed = resolve;
          }),
        );
        mocks.waitForTransactionReceipt.mockReturnValue(new Promise(() => {}));

        const view = await toRevoke();

        mocks.waitForTransactionReceipt.mockReturnValue(new Promise(() => {}));
        await fireEvent.click(revokeIn(view));

        // Signing in the wallet.
        await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalledOnce());
        expect(revokeIn(view)).toBeDisabled();

        signed(`0x${"dd".repeat(32)}`);

        // Waiting for the chain.
        await vi.waitFor(() =>
          expect(mocks.waitForTransactionReceipt).toHaveBeenCalled(),
        );
        expect(revokeIn(view)).toBeDisabled();
      });

      it("hides what's approved now with the balances, as the form before it does", async () => {
        settingsStore.update((store) => ({ ...store, hideBalances: true }));
        mocks.allowance.mockResolvedValue(HALF);

        const view = await toRevoke();

        expect(view.container).not.toHaveTextContent("0.5 BEP20");
      });

      it("says the approval stands when it's declined in the wallet", async () => {
        mocks.allowance.mockResolvedValue(HALF);
        mocks.approve.mockRejectedValue(
          new Error("User rejected the request."),
        );

        const view = await toRevoke();

        await fireEvent.click(revokeIn(view));

        // Said on the review, which stays, with what's approved still: it can
        // be signed again.
        expect(await view.findByRole("alert")).toBeInTheDocument();
        expect(view.getByRole("heading", { name: "Review" })).toBeVisible();
        expect(view.container).toHaveTextContent("0.5 BEP20 DUSK");
        expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
      });

      it("says to check the wallet when it fails, and goes by what the chain says after", async () => {
        mocks.allowance.mockResolvedValue(HALF);
        mocks.waitForTransactionReceipt.mockReset();
        mocks.approve.mockResolvedValue(`0x${"dd".repeat(32)}`);

        const view = await toRevoke();

        mocks.waitForTransactionReceipt.mockResolvedValue({
          status: "reverted",
        });
        await fireEvent.click(revokeIn(view));

        expect(await view.findByRole("alert")).toBeInTheDocument();
        await vi.waitFor(() =>
          expect(view.container).toHaveTextContent("0.5 BEP20 DUSK"),
        );
      });

      it("asks nothing of the wallet when the chain says it's gone already", async () => {
        mocks.allowance.mockResolvedValue(HALF);

        const view = await toRevoke();
        const { container, findByRole } = view;

        mocks.allowance.mockResolvedValue(0n);
        await fireEvent.click(revokeIn(view));

        expect(await findByRole("alert")).toBeInTheDocument();
        expect(mocks.approve).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(panel(container)).toBeNull());
      });

      it("signs from no account but the one shown: another one as it's read stops it", async () => {
        /** @type {(wei: bigint) => void} */
        let answer = () => {};

        mocks.allowance.mockResolvedValue(HALF);

        const view = await toRevoke();
        const { findByRole } = view;

        mocks.allowance.mockReturnValueOnce(
          new Promise((resolve) => {
            answer = resolve;
          }),
        );
        await fireEvent.click(revokeIn(view));
        mocks.account?.update((now) => ({
          ...now,
          address: "0x3333333333333333333333333333333333333333",
        }));
        answer(HALF);

        expect(await findByRole("alert")).toBeInTheDocument();
        expect(mocks.approve).not.toHaveBeenCalled();
      });

      describe("while what's approved is read again", () => {
        /** @type {PromiseWithResolvers<bigint>} */
        let reading;

        /** Revoke pressed, with the chain's answer still to come. */
        async function pressedRevoke() {
          mocks.allowance.mockResolvedValue(HALF);

          const view = await toRevoke();

          reading = Promise.withResolvers();
          mocks.allowance.mockReturnValueOnce(reading.promise);
          await fireEvent.click(revokeIn(view));

          return view;
        }

        /** The chain answers, and whatever follows it has its turn. */
        async function chainAnswers() {
          reading.resolve(HALF);
          await new Promise((resolve) => setTimeout(resolve));
        }

        it("asks the EVM wallet for nothing once the screen was left", async () => {
          const view = await pressedRevoke();

          view.unmount();
          await chainAnswers();

          expect(mocks.approve).not.toHaveBeenCalled();
        });

        it("asks the EVM wallet for nothing once the wallet locked", async () => {
          const generator = new ProfileGenerator(async () =>
            crypto.getRandomValues(new Uint8Array(64)),
          );

          await walletStore.init(generator);

          try {
            await pressedRevoke();
            walletStore.reset();
            await chainAnswers();

            expect(mocks.approve).not.toHaveBeenCalled();
          } finally {
            walletStore.reset();
          }
        });

        it("asks the EVM wallet for nothing once another wallet opened", async () => {
          const generator = new ProfileGenerator(async () =>
            crypto.getRandomValues(new Uint8Array(64)),
          );

          await walletStore.init(generator);

          try {
            await pressedRevoke();
            await walletStore.init(generator, undefined, { key: "another" });
            await chainAnswers();

            expect(mocks.approve).not.toHaveBeenCalled();
          } finally {
            walletStore.reset();
          }
        });
      });

      it("takes no click for half a second once its review shows", async () => {
        mocks.allowance.mockResolvedValue(HALF);

        const view = openRoute();

        await fireEvent.click(
          await view.findByRole("button", { name: "Revoke" }),
        );
        await view.findByRole("heading", { name: "Review" });
        await fireEvent.click(revokeIn(view));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(mocks.approve).not.toHaveBeenCalled();
      });
    });
  });

  describe("with something elsewhere only the public balance can pay to get at", () => {
    const keepForLater = { lux: 50_000_000n, why: "to unstake later" };

    it("keeps the fee for it on a transfer out's Max, and warns of an amount over that", async () => {
      connect({ address: EVM, chainId: 1 });

      const { container, findByRole, getByRole } = render(Bridge, {
        ...props,
        keepForLater,
        linkedRoute: "dusk-to-bsc",
      });
      const amount = await findByRole("textbox", { name: "Amount, in DUSK" });

      await fireEvent.click(getByRole("button", { name: "Max" }));

      const fee =
        props.transferGasSettings.gasLimit * props.transferGasSettings.gasPrice;

      expect(/** @type {HTMLInputElement} */ (amount).value).toBe(
        formatDuskPlain(props.unshieldedBalance - fee - keepForLater.lux),
      );
      // It says what Max keeps, with no warning.
      expect(container).toHaveTextContent("0.05 DUSK");
      expect(said(container)).toStrictEqual([]);

      await fireEvent.input(amount, {
        target: { value: formatDuskPlain(props.unshieldedBalance - fee) },
      });

      // Over it: a warning, and nothing said of what Max keeps.
      expect(said(container)).toHaveLength(1);
      expect(container).not.toHaveTextContent("0.05 DUSK");
    });
  });

  describe("once it's sent, for as long as the screen is open", () => {
    const HASH = "ab".repeat(32);
    // A wallet may answer with any capitals: it's kept in lower case.
    const MIGRATED = `0x${"BB".repeat(32)}`;
    /** @param {string} id */
    const routeOf = (id) =>
      cardRoutes(networks.mainnet).find((r) => r.id === id);

    /**
     * What the screen says once it's sent.
     *
     * @param {HTMLElement} container
     */
    const resultOf = (container) =>
      /** @type {HTMLElement} */ (container.querySelector(".route-result"));

    /** A transfer out of 2 DUSK, sent. */
    async function sendOut() {
      connect({ address: EVM, chainId: 56 });
      mocks.executeSend.mockResolvedValue(HASH);

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } },
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" }),
      );
      await afterConfirmDelay();
      await fireEvent.click(view.getByRole("button", { name: "Send" }));
      // Sent: when it usually arrives.
      await vi.waitFor(() =>
        expect(resultOf(view.container)).toHaveTextContent("10 hours"),
      );

      return view;
    }

    /** @param {Record<string, unknown>} fields */
    const out = (fields) => ({
      amountLux: 2n * DUSK,
      at: Date.now(),
      feeLux: DUSK,
      hash: HASH,
      kind: "service",
      recipient: EVM,
      route: routeOf("dusk-to-bsc"),
      stage: "sent",
      ...fields,
    });

    afterEach(() => {
      mocks.transfers?.set([]);
    });

    it("says what arrived once a transfer out has", async () => {
      const result = resultOf((await sendOut()).container);

      mocks.transfers?.set([out({ stage: "sent" })]);
      await tick();

      // On its way: 1 DUSK, on BNB Smart Chain in about 10 hours.
      expect(result).toHaveTextContent("1 DUSK");
      expect(result).toHaveTextContent("BNB Smart Chain");
      expect(result).toHaveTextContent("10 hours");

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);

      // Arrived: the 1 DUSK on BNB Smart Chain, with no time to go.
      await vi.waitFor(() => expect(result).not.toHaveTextContent("10 hours"));
      expect(result).toHaveTextContent("1 DUSK");
      expect(result).toHaveTextContent("BNB Smart Chain");
    });

    it("follows a transfer out whose answer got lost, never saying it was sent before the chain has it", async () => {
      const found = Promise.withResolvers();

      connect({ address: EVM, chainId: 56 });
      mocks.executeSend.mockRejectedValueOnce(
        outcomeUnknown(new TypeError("Failed to fetch"), HASH),
      );
      mocks.followTransaction.mockReturnValueOnce(found.promise);

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } },
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" }),
      );
      await afterConfirmDelay();
      await fireEvent.click(view.getByRole("button", { name: "Send" }));

      // It follows the hash it may have gone out with...
      await vi.waitFor(() =>
        expect(mocks.followTransaction).toHaveBeenCalledWith(
          HASH,
          expect.anything(),
        ),
      );

      const result = resultOf(view.container);

      // ...saying what went where, but not when it arrives, as sent, and
      // offering nothing to send it again.
      expect(result).toHaveTextContent("2 DUSK");
      expect(result).toHaveTextContent("BNB Smart Chain");
      expect(result).not.toHaveTextContent("10 hours");
      expect(view.queryByRole("button", { name: "Try again" })).toBeNull();

      found.resolve({ blockHeight: 9n, error: null, fee: 1n, timestamp: 1 });

      // Once the chain has it: sent, with what arrives, and when.
      await vi.waitFor(() => expect(result).toHaveTextContent("10 hours"));
      expect(result).toHaveTextContent("1 DUSK");
    });

    it("says a migration is in the public balance once it's paid", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockResolvedValue(MIGRATED);
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      connect({ address: EVM, chainId: 1 });

      const { container, findByRole, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "ethereum-to-dusk",
      });

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "2,5" } },
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      // Until it's paid, what's on its way, and when.
      await vi.waitFor(() =>
        expect(resultOf(container)).toHaveTextContent("70 min"),
      );

      const result = resultOf(container);

      expect(result).toHaveTextContent("2.5 DUSK");

      mocks.transfers?.set([
        {
          amountLux: 2_500_000_000n,
          at: Date.now(),
          hash: MIGRATED.toLowerCase(),
          kind: "migration",
          paidAt: Date.now(),
          payout: "dd",
          recipient: ACCOUNT,
          route: routeOf("ethereum-to-dusk"),
          stage: "paid",
        },
      ]);

      // Paid: the 2.5 DUSK, with no time to go.
      await vi.waitFor(() => expect(result).not.toHaveTextContent("70 min"));
      expect(result).toHaveTextContent("2.5 DUSK");
    });

    it("says so when a transfer takes twice its usual time, or fails", async () => {
      const result = resultOf((await sendOut()).container);

      mocks.transfers?.set([out({ at: Date.now() - 86_400_000 })]);

      // Late: no longer when it usually arrives, nor that 1 DUSK did.
      await vi.waitFor(() => expect(result).not.toHaveTextContent("10 hours"));
      expect(result).not.toHaveTextContent("1 DUSK");

      mocks.transfers?.set([
        out({
          failure: "The bridge didn't take this transfer",
          stage: "failed",
        }),
      ]);

      // Failed: why, as the bridge's record says.
      await vi.waitFor(() =>
        expect(result).toHaveTextContent(
          "The bridge didn't take this transfer",
        ),
      );
      expect(result).not.toHaveTextContent("10 hours");
    });

    it("keeps amounts hidden while balances are", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const result = resultOf((await sendOut()).container);

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);

      // Arrived on BNB Smart Chain, with no figure.
      await vi.waitFor(() => expect(result).not.toHaveTextContent("10 hours"));
      expect(result).toHaveTextContent("BNB Smart Chain");
      expect(result).not.toHaveTextContent("1 DUSK");
    });
  });

  describe("what a review says before anything is signed", () => {
    /** A migration of 1 ERC20 DUSK, up to its review. */
    async function reviewMigration() {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      connect({ address: EVM, chainId: 1 });

      const view = render(Bridge, {
        ...props,
        linkedRoute: "ethereum-to-dusk",
      });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "1" } },
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review migration" }),
      );

      return view;
    }

    const ethereum = () => networks.mainnet.routes.chains.ethereum;

    it("names the contract an approval lets take the amount, and the token, on their chain", async () => {
      mocks.allowance.mockResolvedValue(0n);

      const { container } = await reviewMigration();
      const contract = /** @type {any} */ (
        networks.mainnet.routes.migrations.find((m) => m.chain === "ethereum")
      ).contract;

      // For whoever checks them against the wallet: the chain, by its ID 1,
      // the migration contract, and the token.
      const check = /** @type {HTMLDetailsElement} */ (
        container.querySelector("details.route-review__check")
      );

      expect(check).toHaveTextContent(/Ethereum\D*1(?!\d)/);
      expect(check).toHaveTextContent(contract);
      expect(check).toHaveTextContent("ERC20 DUSK");
      expect(check).toHaveTextContent(ethereum().token);
    });

    it("says what the wallet holds for the network fee, and asks nothing without any", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getNativeBalance.mockResolvedValueOnce(12_345n * 10n ** 14n);

      let view = await reviewMigration();

      // The fee, from what the wallet holds on Ethereum.
      await vi.waitFor(() =>
        expect(view.container).toHaveTextContent("0.00012 ETH"),
      );
      expect(view.container).toHaveTextContent("1.2345 ETH");
      expect(mocks.getNativeBalance).toHaveBeenCalledWith(EVM, 1);
      cleanup();

      mocks.getNativeBalance.mockResolvedValueOnce(0n);
      view = await reviewMigration();

      expect(
        await view.findByRole("button", { name: "No ETH for the network fee" }),
      ).toBeDisabled();
      expect(view.queryByRole("button", { name: "Migrate" })).toBeNull();
    });

    it("keeps what the wallet holds hidden while balances are", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getNativeBalance.mockResolvedValueOnce(12_345n * 10n ** 14n);

      const { container, findByRole } = await reviewMigration();

      await findByRole("button", { name: "Migrate" });
      // The fee, said once what the wallet holds is read, and not that.
      await vi.waitFor(() =>
        expect(container).toHaveTextContent("0.00012 ETH"),
      );
      expect(container).not.toHaveTextContent("1.2345");
    });

    it("goes by the last review's reading, however late an older one answers", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);

      /** @type {(wei: bigint) => void} */
      let answerOld = () => {};

      mocks.getNativeBalance.mockReturnValueOnce(
        new Promise((resolve) => {
          answerOld = resolve;
        }),
      );

      const { findByRole, getByRole } = await reviewMigration();

      await fireEvent.click(await findByRole("button", { name: "Back" }));
      mocks.getNativeBalance.mockResolvedValueOnce(DUSK * DUSK);
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await findByRole("button", { name: "Migrate" });

      answerOld(0n);
      await tick();
      await tick();

      // Its none of ETH doesn't take Migrate away.
      expect(getByRole("button", { name: "Migrate" })).toBeEnabled();
    });

    it("names the bridge's account a transfer out goes through", async () => {
      connect({ address: EVM, chainId: 56 });

      const { container, findByRole, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "dusk-to-bsc",
      });

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } },
      );
      await fireEvent.click(getByRole("button", { name: "Review bridge" }));

      const service = /** @type {any} */ (
        networks.mainnet.routes.services.find((s) => s.chain === "bsc")
      );

      // For whoever checks them: the bridge's account it goes to, and the
      // address it pays, as its memo.
      const check = /** @type {HTMLDetailsElement} */ (
        container.querySelector("details.route-review__check")
      );

      expect(check).toHaveTextContent(service.account);
      expect(check).toHaveTextContent(EVM);
    });

    it("says why an amount with too many decimals won't do, on both routes", async () => {
      connect({ address: EVM, chainId: 56 });

      const out = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await out.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "1.0123456789" } },
      );

      expect(
        out.getByRole("button", { name: "Use at most 9 decimals" }),
      ).toBeDisabled();
      cleanup();

      const view = await reviewMigration();

      await fireEvent.click(await view.findByRole("button", { name: "Back" }));
      await fireEvent.input(
        view.getByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "1.0123456789" } },
      );

      expect(
        view.getByRole("button", { name: "Use at most 9 decimals" }),
      ).toBeDisabled();
    });
  });

  describe("when the wallet or its account changes course", () => {
    const REFUSED = new Error(
      "An error occurred while approving the DUSK: User rejected the request.",
    );

    /** A migration of 1 ERC20 DUSK, up to its review. */
    async function toReview() {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      connect({ address: EVM, chainId: 1 });

      const view = render(Bridge, {
        ...props,
        linkedRoute: "ethereum-to-dusk",
      });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "1" } },
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review migration" }),
      );
      await view.findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();

      return view;
    }

    it("goes back to the review, and migrates nothing, when the approval is refused", async () => {
      mocks.allowance.mockResolvedValue(0n);
      mocks.approve.mockRejectedValue(REFUSED);

      const { findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      expect(await findByRole("alert")).toBeInTheDocument();
      expect(getByRole("button", { name: "Migrate" })).toBeInTheDocument();
      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("asks only to migrate next when the approval went through and only the migration is refused", async () => {
      mocks.allowance.mockResolvedValueOnce(0n);
      mocks.approve.mockResolvedValue(`0x${"aa".repeat(32)}`);
      mocks.migrate.mockRejectedValueOnce(
        new Error("User rejected the request."),
      );

      const { findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      expect(await findByRole("alert")).toBeInTheDocument();

      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.click(getByRole("button", { name: "Review migration" }));

      const migrate = await findByRole("button", { name: "Migrate" });

      await vi.waitFor(() => expect(migrate).toBeEnabled());
      await afterConfirmDelay();
      await fireEvent.click(migrate);

      // The approval it gave covers it: no second one.
      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalledTimes(2));
      expect(mocks.approve).toHaveBeenCalledOnce();
    });

    it("never offers to send it again when the wallet's answer got lost, as it may have gone out", async () => {
      const { outcomeUnknown } = await import("$lib/transactions");

      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockRejectedValue(
        outcomeUnknown(new Error("The request took too long to respond.")),
      );

      const { container, getByRole, queryByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await failureShown(container);

      expect(queryByRole("button", { name: "Back" })).toBeNull();
      expect(queryByRole("button", { name: "Migrate" })).toBeNull();
      expect(queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("offers to try again when it failed before it went out", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockRejectedValueOnce(
        new Error("The contract would revert."),
      );

      const { findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await fireEvent.click(await findByRole("button", { name: "Try again" }));

      expect(
        await findByRole("button", { name: "Migrate" }),
      ).toBeInTheDocument();
    });

    describe("what the wallet answers with an error and no hash", () => {
      /** The wallet's refusal of a migrate its allowance no longer covers. */
      const usedUp = () =>
        outcomeUnknown(
          new Error(
            "execution reverted: BEP20: transfer amount exceeds allowance",
          ),
        );

      it("offers to approve again, with nothing sent, once the allowance was used up elsewhere", async () => {
        // Enough as it's reviewed and sent; used up by another tab as it's signed.
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          throw usedUp();
        });

        const { findByRole, getByRole } = await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));
        await fireEvent.click(
          await findByRole("button", { name: "Approve again" }),
        );

        // The review again, with nothing more sent.
        expect(
          await findByRole("button", { name: "Migrate" }),
        ).toBeInTheDocument();
        expect(mocks.migrate).toHaveBeenCalledOnce();
      });

      it("offers to try again, not to approve, where the allowance still covers it", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockRejectedValueOnce(
          outcomeUnknown(new Error("execution reverted: Paused")),
        );

        const { findByRole, getByRole, queryByRole } = await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        const again = await findByRole("button", { name: "Try again" });

        expect(queryByRole("button", { name: "Approve again" })).toBeNull();

        await fireEvent.click(again);

        expect(
          await findByRole("button", { name: "Migrate" }),
        ).toBeInTheDocument();
      });

      it("says the same of a check that fails before the wallet is asked", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          throw new Error(
            'The contract function "migrate" reverted with the following reason:\nBEP20: transfer amount exceeds allowance',
          );
        });

        const { findByRole, getByRole } = await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        expect(
          await findByRole("button", { name: "Approve again" }),
        ).toBeInTheDocument();
      });

      it("keeps to Not confirmed for what proves nothing, however the allowance reads", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          throw outcomeUnknown(new Error("Internal JSON-RPC error."));
        });

        const { container, getByRole, queryByRole } = await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));
        await failureShown(container);

        expect(queryByRole("button", { name: "Approve again" })).toBeNull();
        expect(queryByRole("button", { name: "Try again" })).toBeNull();
      });

      it("says it isn't known once the chain was asked about what was sent, whatever it says", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);

        const { container, getByRole, queryByRole } = await toReview();

        mocks.waitForTransactionReceipt.mockRejectedValue(
          new Error("execution reverted"),
        );
        await fireEvent.click(getByRole("button", { name: "Migrate" }));
        await failureShown(container);

        expect(queryByRole("button", { name: "Try again" })).toBeNull();
      });
    });

    it("asks for no migration once the page was left while the approval was signed", async () => {
      /** @type {(hash: string) => void} */
      let signed = () => {};

      mocks.allowance.mockResolvedValue(0n);
      mocks.approve.mockReturnValue(
        new Promise((resolve) => {
          signed = resolve;
        }),
      );

      const { getByRole, unmount } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalled());

      unmount();
      signed(`0x${"aa".repeat(32)}`);
      await vi.waitFor(() =>
        expect(mocks.waitForTransactionReceipt).toHaveBeenCalled(),
      );
      await tick();
      await tick();

      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("asks for the route's chain on a review the wallet left, and sends nothing until it's back", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);
      mocks.switchChain.mockRejectedValueOnce(
        new Error("User rejected the request."),
      );

      const { askToSwitch } = await import("$lib/bridge/chainSwitch");
      const { findByRole, getByRole, queryByRole } = await toReview();

      connect({ address: EVM, chainId: 56 });
      await askToSwitch(1);

      const again = await findByRole("button", { name: "Switch to Ethereum" });

      expect(queryByRole("button", { name: "Migrate" })).toBeNull();

      mocks.switchChain.mockResolvedValueOnce({ id: 1 });
      await fireEvent.click(again);
      expect(mocks.switchChain).toHaveBeenCalledTimes(2);

      connect({ address: EVM, chainId: 1 });
      await afterConfirmDelay();

      expect(
        await findByRole("button", { name: "Migrate" }),
      ).toBeInTheDocument();
      expect(getByRole("heading", { name: "Review" })).toBeInTheDocument();
      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("migrates from no account but the one reviewed: another one after the approval stops it", async () => {
      mocks.allowance.mockResolvedValue(0n);
      mocks.approve.mockImplementation(async () => {
        connect({
          address: "0x3333333333333333333333333333333333333333",
          chainId: 1,
        });

        return `0x${"aa".repeat(32)}`;
      });

      const { findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      expect(await findByRole("alert")).toBeInTheDocument();
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(
        getByRole("button", { name: "Review migration" }),
      ).toBeInTheDocument();
    });

    it("signs with the account reviewed, so the wallet can't use another", async () => {
      mocks.allowance.mockResolvedValue(0n);
      mocks.approve.mockResolvedValue(`0x${"aa".repeat(32)}`);
      mocks.migrate.mockResolvedValue(`0x${"bb".repeat(32)}`);

      const { getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

      expect(mocks.approve.mock.calls[0].at(-1)).toBe(EVM);
      expect(mocks.migrate.mock.calls[0].at(-1)).toBe(EVM);
    });

    it("closes a review when the account changes under it, and says so", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);

      const { findByRole, getByRole, queryByRole } = await toReview();

      connect({
        address: "0x3333333333333333333333333333333333333333",
        chainId: 1,
      });

      expect(await findByRole("alert")).toBeInTheDocument();
      expect(queryByRole("button", { name: "Migrate" })).toBeNull();
      expect(
        getByRole("button", { name: "Review migration" }),
      ).toBeInTheDocument();
    });

    it("closes the review of a transfer out when the address it pays changes", async () => {
      connect({ address: EVM, chainId: 56 });

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } },
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" }),
      );
      await view.findByRole("button", { name: "Send" });

      connect({
        address: "0x3333333333333333333333333333333333333333",
        chainId: 56,
      });

      expect(await view.findByRole("alert")).toBeInTheDocument();
      expect(view.queryByRole("button", { name: "Send" })).toBeNull();
    });
  });

  it("offers to try again when a transfer out failed before it went out, back to its review with what's filled in", async () => {
    const reason = `Tx ${"ab".repeat(32)} not accepted: gas price lower than minimum 1`;

    mocks.executeSend.mockRejectedValue(new Error(reason));
    connect({ address: EVM, chainId: 1 });

    const { container, findByRole, getByRole } = render(Bridge, props);

    await fireEvent.input(getByRole("textbox", { name: "Amount, in DUSK" }), {
      target: { value: "2" },
    });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Send" }));

    // Nothing went out: back to the review, with what's filled in.
    await fireEvent.click(await findByRole("button", { name: "Try again" }));

    expect(getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(container.querySelector(".route-review__line")).toHaveTextContent(
      "2 DUSK",
    );
    expect(mocks.executeSend).toHaveBeenCalledOnce();
  });

  it("offers no Try again on a transfer out when it may have gone out", async () => {
    mocks.executeSend.mockRejectedValue(
      outcomeUnknown(new TypeError("Failed to fetch")),
    );
    connect({ address: EVM, chainId: 1 });

    const { container, getByRole, queryByRole } = render(Bridge, props);

    await fireEvent.input(getByRole("textbox", { name: "Amount, in DUSK" }), {
      target: { value: "2" },
    });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Send" }));
    await failureShown(container);

    expect(queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says a route isn't running, as a link to one opens it", async () => {
    // Testnet's routes to its BSC test chain stopped.
    setNodeNetwork(routesStopped(networks.testnet));

    const { getByRole } = render(Bridge, {
      ...props,
      linkedRoute: "bsc-to-dusk",
    });

    // Nothing to fill in, and nothing to review.
    expect(
      getByRole("button", { name: "Not running right now" }),
    ).toBeDisabled();
    expect(
      getByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
    ).toBeDisabled();
  });
});
