import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { ProfileGenerator } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";
import { tick } from "svelte";
import { get } from "svelte/store";

import { stopArrivalNotice } from "$lib/bridge/arrivalNotice";
import { cardRoutes } from "$lib/bridge/cardRoutes";
import { formatDuskPlain } from "$lib/dusk/currency";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import styleRules from "$lib/dusk/test-helpers/styleRules";
import { InvalidPasswordError } from "$lib/errors";
import {
  cancelSendPassword,
  sendPasswordAsk,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import { settingsStore, walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { outcomeUnknown } from "$lib/transactions/outcomeUnknown";
import { forgetDuskAdded } from "$lib/web3/addDusk";

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
  /** @type {import("vitest").Mock<(...args: any[]) => Promise<boolean>>} */
  watchAsset: vi.fn(async () => true),
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
    watchAsset: mocks.watchAsset,
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

/** @param {HTMLElement} container */
const direction = (container) =>
  ["from", "to"].map((side) =>
    container
      .querySelector(`button[data-side='${side}']`)
      ?.getAttribute("data-value")
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
    forgetDuskAdded();
    localStorage.clear();
    settingsStore.update((store) => ({ ...store, hideBalances: false }));
  });

  it("hides what Max fills in on a route while balances are hidden, and shows what's typed", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      connect({ address: EVM, chainId: 1 });

      const { container, getByRole } = render(Bridge, props);
      const amount = getByRole("textbox", { name: "Amount, in DUSK" });

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(amount).toHaveValue("••••");
      expect(container.querySelector("output")).toHaveTextContent(
        "•••• hidden"
      );

      await fireEvent.click(getByRole("button", { name: "Review bridge" }));

      expect(container).toHaveTextContent("•••• DUSK to");
      expect(container.querySelector(".route-review")).not.toHaveTextContent(
        /\d DUSK arrives/
      );
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
        expect(getByRole("button", { name: "Max" })).toBeEnabled()
      );
      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(amount).toHaveValue("••••");
      expect(container.querySelector("output")).toHaveTextContent(
        "•••• hidden"
      );

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
    expect(container.querySelector(".swap-route summary")).toHaveTextContent(
      "~10 hours · 1 DUSK bridge fee"
    );
    // No field for an address: it comes from the wallet.
    expect(queryByRole("textbox", { name: /address/i })).toBeNull();
    expect(
      getByRole("button", { name: "Connect an EVM wallet" })
    ).toBeEnabled();

    connect({ address: EVM, chainId: 1 });
    await tick();

    const amount = getByRole("textbox", { name: "Amount, in DUSK" });

    await fireEvent.input(amount, { target: { value: "1" } });

    expect(
      getByRole("button", { name: "Send more than the 1 DUSK bridge fee" })
    ).toBeDisabled();

    await fireEvent.input(amount, { target: { value: "2" } });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));

    expect(container).toHaveTextContent(
      "2 DUSK sent · 1 DUSK bridge fee · 1 DUSK arrives on BNB Smart Chain"
    );
    expect(container).toHaveTextContent(
      "It usually arrives in about 10 hours."
    );
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
      2_500_000n
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
      getByRole("button", { name: "Switch to BNB Smart Chain" })
    ).toBeEnabled();

    connect({ address: EVM, chainId: 56 });

    const amount = await findByRole("textbox", {
      name: "Amount, in BEP20 DUSK",
    });

    expect(mocks.getBalanceOfCoin).toHaveBeenCalledWith(
      EVM,
      networks.mainnet.routes.chains.bsc.token,
      56
    );

    await fireEvent.input(amount, { target: { value: "2,5" } });
    await fireEvent.click(getByRole("button", { name: "Review migration" }));

    expect(await findByRole("button", { name: "Migrate" })).toBeEnabled();
    expect(container).toHaveTextContent(
      "Approve the amount, then migrate, in your wallet"
    );
    expect(container).toHaveTextContent(
      `Amount 2.5 DUSK From BNB Smart Chain ${EVM} To Your public account on Dusk ${ACCOUNT}`
    );

    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Migrate" }));
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

    const wei = 2_500_000_000n * DUSK;

    expect(mocks.approve).toHaveBeenCalledWith(
      migration.contract,
      networks.mainnet.routes.chains.bsc.token,
      wei,
      56,
      EVM
    );
    expect(mocks.migrate).toHaveBeenCalledWith(
      wei,
      56,
      ACCOUNT,
      migration.contract,
      EVM
    );
    // Kept for Bridge › Activity until it's paid.
    expect(
      JSON.parse(localStorage.getItem("web-wallet-migrations") ?? "[]")
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

    const { container, findByRole, getByRole } = render(Bridge, {
      ...props,
      linkedRoute: "ethereum-to-dusk",
    });

    await fireEvent.input(
      await findByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
      { target: { value: "1" } }
    );
    await fireEvent.click(getByRole("button", { name: "Review migration" }));
    await findByRole("button", { name: "Migrate" });

    expect(container).toHaveTextContent("Migrate, in your wallet");

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
        { target: { value: "2" } }
      );
      await lockAndUnlock();

      const back = render(Bridge, props);

      expect(
        back.getByRole("textbox", { name: "Amount, in DUSK" })
      ).toHaveValue("2");

      mocks.executeSend.mockReturnValue(new Promise(() => {}));
      await fireEvent.click(
        back.getByRole("button", { name: "Review bridge" })
      );
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Send" }));
      await lockAndUnlock();

      expect(
        render(Bridge, props).getByRole("textbox", { name: "Amount, in DUSK" })
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
          { target: { value: "2" } }
        );
        await fireEvent.click(
          view.getByRole("button", { name: "Review bridge" })
        );
        await afterConfirmDelay();
        await fireEvent.click(view.getByRole("button", { name: "Send" }));

        return view;
      }

      const failed = await failWith(new TypeError("Failed to fetch"));

      await failed.findByRole("button", { name: "Try again" });
      cleanup();

      expect(
        render(Bridge, props).getByRole("textbox", { name: "Amount, in DUSK" })
      ).toHaveValue("2");
      cleanup();

      const unknown = await failWith(
        outcomeUnknown(new TypeError("Failed to fetch"))
      );

      await unknown.findByText("Not confirmed");
      cleanup();

      expect(
        render(Bridge, props).getByRole("textbox", { name: "Amount, in DUSK" })
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
        { target: { value: "1,5" } }
      );
      await lockAndUnlock();

      const back = render(Bridge, opened);
      const amount = await back.findByRole("textbox", {
        name: "Amount, in BEP20 DUSK",
      });

      expect(amount).toHaveValue("1,5");

      await vi.waitFor(() => expect(amount).toBeEnabled());
      await fireEvent.click(
        back.getByRole("button", { name: "Review migration" })
      );
      await back.findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();
      await fireEvent.click(back.getByRole("button", { name: "Migrate" }));
      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());
      await lockAndUnlock();

      expect(
        await render(Bridge, opened).findByRole("textbox", {
          name: "Amount, in BEP20 DUSK",
        })
      ).toHaveValue("");
    });

    it("keeps the route picked, and leaves it for a link to another", async () => {
      connect({ address: EVM, chainId: 1 });

      const typed = render(Bridge, props);

      await fireEvent.click(
        typed.getByRole("button", { name: "Swap From and To" })
      );

      const picked = direction(typed.container);

      await lockAndUnlock();

      expect(direction(render(Bridge, props).container)).toStrictEqual(picked);

      await lockAndUnlock();

      expect(
        direction(
          render(Bridge, { ...props, linkedRoute: "ethereum-to-dusk" })
            .container
        )
      ).toStrictEqual(["ethereum", "duskDs"]);
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
        { target: { value } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review migration" })
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
        InvalidPasswordError
      );

      expect(mocks.migrate).not.toHaveBeenCalled();

      await get(sendPasswordAsk)?.answer(PASSWORD);

      await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalledOnce());
    });

    it("goes back to the review when it isn't given, with nothing moved", async () => {
      const { findByRole } = await migrationOf("2");

      await vi.waitFor(() => expect(get(sendPasswordAsk)).not.toBeNull());
      get(sendPasswordAsk)?.cancel();

      expect(await findByRole("alert")).toHaveTextContent(
        "It waits for your password, so nothing moved."
      );
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
      expect(panel(container)).toHaveTextContent(
        "Open approval The migration contract may still take 0.5 BEP20 DUSK from this wallet."
      );
      expect(mocks.allowance).toHaveBeenCalledWith(
        EVM,
        BSC.token,
        BSC_CONTRACT,
        56
      );
      // Nothing of it is kept here.
      expect(
        Object.keys(localStorage).filter((key) => /approv/i.test(key))
      ).toStrictEqual([]);
    });

    it("says one wallet step on the form for an amount the approval covers, and both for more", async () => {
      mocks.allowance.mockResolvedValue(HALF);

      const { container, findByRole, getByRole } = openRoute();
      const steps = () =>
        /** @type {HTMLElement} */ (container.querySelector(".swap-route"))
          .textContent;

      await findByRole("button", { name: "Revoke" });
      await fireEvent.input(
        getByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "0.5" } }
      );

      expect(steps()).toContain("migrate, in your BNB Smart Chain wallet");
      expect(steps()).not.toMatch(/approve/i);

      await fireEvent.input(
        getByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "0.6" } }
      );

      expect(steps()).toContain(
        "approve, then migrate, in your BNB Smart Chain wallet"
      );
    });

    it("offers to add DUSK to a wallet that holds none of it yet, on the way back's form", async () => {
      const wallet = { name: "Test MetaMask", type: "injected", uid: "w3" };

      mocks.allowance.mockResolvedValue(0n);
      mocks.getBalanceOfCoin.mockResolvedValue(0n);
      connect({ address: EVM, chainId: 56, connector: wallet });

      const none = render(Bridge, { ...props, linkedRoute: "bsc-to-dusk" });

      await fireEvent.click(
        await none.findByRole("button", { name: "Add DUSK to Test MetaMask" })
      );
      expect(mocks.switchChain).not.toHaveBeenCalled();
      expect(mocks.watchAsset).toHaveBeenCalledOnce();
      cleanup();
      forgetDuskAdded();

      // Some of it there: nothing to offer.
      mocks.getBalanceOfCoin.mockResolvedValue(DUSK * DUSK);

      const some = render(Bridge, { ...props, linkedRoute: "bsc-to-dusk" });

      await vi.waitFor(() =>
        expect(
          some.container.querySelector("#migration-balance")
        ).toHaveTextContent("1 BEP20 DUSK")
      );
      await tick();

      expect(
        some.queryByRole("button", { name: "Add DUSK to Test MetaMask" })
      ).toBeNull();
    });

    it("shows nothing with nothing approved, or none that could be read, or on another chain", async () => {
      mocks.allowance.mockResolvedValue(0n);

      const none = openRoute();

      await none.findByRole("textbox", { name: "Amount, in BEP20 DUSK" });
      await vi.waitFor(() => expect(mocks.allowance).toHaveBeenCalled());
      await tick();

      expect(panel(none.container)).toBeNull();
      cleanup();

      mocks.allowance.mockRejectedValue(new Error("No answer."));

      const unread = openRoute();

      await unread.findByRole("textbox", { name: "Amount, in BEP20 DUSK" });
      await tick();

      expect(panel(unread.container)).toBeNull();
      cleanup();

      mocks.allowance.mockClear();
      mocks.allowance.mockResolvedValue(HALF);
      connect({ address: EVM, chainId: 1 });

      const elsewhere = render(Bridge, {
        ...props,
        linkedRoute: "bsc-to-dusk",
      });

      await tick();

      expect(mocks.allowance).not.toHaveBeenCalled();
      expect(panel(elsewhere.container)).toBeNull();
    });

    it("hides the amount with the balances, and says one with no limit as that, there and on a review", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      mocks.allowance.mockResolvedValue(HALF);

      const hidden = openRoute();

      await hidden.findByRole("button", { name: "Revoke" });

      expect(panel(hidden.container)).toHaveTextContent(
        "may still take •••• hidden BEP20 DUSK"
      );
      cleanup();
      settingsStore.update((store) => ({ ...store, hideBalances: false }));

      mocks.allowance.mockResolvedValue(2n ** 256n - 1n);

      const unlimited = openRoute();

      await unlimited.findByRole("button", { name: "Revoke" });

      expect(panel(unlimited.container)).toHaveTextContent(
        "may still take any amount of BEP20 DUSK from this wallet"
      );

      await fireEvent.input(
        unlimited.getByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "1" } }
      );
      await fireEvent.click(
        unlimited.getByRole("button", { name: "Review migration" })
      );

      await vi.waitFor(() =>
        expect(unlimited.container).toHaveTextContent(
          "An earlier approval with no limit covers this, so you aren't asked to approve. It stays approved after it."
        )
      );
    });

    it("finishes on the review with what the approval still lets go, which says it's approved already", async () => {
      mocks.allowance.mockResolvedValue(HALF);
      mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);

      const { container, findByRole, getByRole } = openRoute();

      await fireEvent.click(await findByRole("button", { name: "Finish" }));

      await findByRole("heading", { name: "Review" });
      await vi.waitFor(() =>
        expect(container).toHaveTextContent("Migrate, in your wallet")
      );
      expect(container.querySelector(".review-amount")).toHaveTextContent(
        "0.5 DUSK"
      );
      expect(container).toHaveTextContent(
        "Approval An earlier approval of 0.5 BEP20 DUSK covers this, so you aren't asked to approve. None of it stays approved after it."
      );

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
        await more.findByRole("button", { name: "Finish" })
      );
      await more.findByRole("heading", { name: "Review" });

      expect(more.container.querySelector(".review-amount")).toHaveTextContent(
        "5 DUSK"
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

      const { container, findByRole, getByRole, queryByText } = openRoute();

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "0.2" } }
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await vi.waitFor(() =>
        expect(container).toHaveTextContent("Migrate, in your wallet")
      );

      expect(container).toHaveTextContent(
        "Approval An earlier approval of 0.5 BEP20 DUSK covers this, so you aren't asked to approve. 0.3 BEP20 DUSK stays approved after it."
      );
      expect(queryByText(/exactly this amount/)).toBeNull();
    });

    it("keeps to \"exactly this amount\" where it's true: an approval that doesn't cover it is replaced", async () => {
      mocks.allowance.mockResolvedValue(HALF);

      const { container, findByRole, getByRole } = openRoute();

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "1" } }
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await vi.waitFor(() =>
        expect(container).toHaveTextContent(
          "Approve the amount, then migrate, in your wallet"
        )
      );

      expect(container).toHaveTextContent(
        "You allow the migration contract to take exactly this amount."
      );
      expect(container).not.toHaveTextContent("An earlier approval");
    });

    it("hides what an approval leaves on the review with the balances", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      mocks.allowance.mockResolvedValue(HALF);

      const { container, findByRole, getByRole } = openRoute();

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in BEP20 DUSK" }),
        { target: { value: "0.2" } }
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await vi.waitFor(() =>
        expect(container).toHaveTextContent("An earlier approval")
      );

      expect(container).not.toHaveTextContent("0.3 BEP20");
      expect(container).not.toHaveTextContent("0.5 BEP20");
    });

    describe("Revoke", () => {
      /** The review of a revoke, from the form's Revoke, able to take a click. */
      async function toRevoke() {
        const view = openRoute();

        await fireEvent.click(
          await view.findByRole("button", { name: "Revoke" })
        );
        await view.findByRole("heading", { name: "Review" });
        await afterConfirmDelay();

        return view;
      }

      /** The review's button, which asks the EVM wallet to sign the revoke. */
      const revokeIn = (/** @type {any} */ { getByRole }) =>
        getByRole("button", { name: "Revoke in your wallet" });

      /** What the page says of where things are, as a screen reader hears it. */
      const statuses = (/** @type {any} */ { queryAllByRole }) =>
        queryAllByRole("status")
          .map((/** @type {Element} */ status) => status.textContent?.trim())
          .filter(Boolean);

      it("is reviewed first, as the standalone's: what's approved now, from where, what it costs, and that nothing moves, with Back", async () => {
        mocks.allowance.mockResolvedValue(HALF);

        const view = openRoute();

        await fireEvent.click(
          await view.findByRole("button", { name: "Revoke" })
        );

        const review = /** @type {HTMLElement} */ (
          (await view.findByRole("heading", { name: "Review" })).parentElement
        );

        expect(mocks.approve).not.toHaveBeenCalled();
        expect(mocks.pushState).toHaveBeenCalledWith("", { routeRevoke: true });
        expect(review).toHaveTextContent("Approved now 0.5 BEP20 DUSK");
        expect(review).toHaveTextContent(`From BNB Smart Chain ${EVM}`);
        expect(review).toHaveTextContent(
          "Steps Revoke, in your wallet: nothing moves"
        );
        expect(review).toHaveTextContent(
          "After it The migration contract can take no BEP20 DUSK from this wallet."
        );
        await vi.waitFor(() =>
          expect(review).toHaveTextContent(
            "Network fees About 0.000024 BNB, from your 1 BNB"
          )
        );
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
        expect(await findByRole("alert")).toHaveTextContent(
          "The approval is revoked."
        );
        expect(queryByRole("heading", { name: "Review" })).toBeNull();
        expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(
          BSC_CONTRACT,
          BSC.token,
          0n,
          56,
          EVM
        );
        expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(
          {},
          { chainId: 56, hash: `0x${"dd".repeat(32)}` }
        );
        await vi.waitFor(() => expect(panel(container)).toBeNull());
        expect(queryByRole("button", { name: "Revoke" })).toBeNull();
      });

      it("says where it is while it waits, and takes no second press", async () => {
        /** @type {(hash: string) => void} */
        let signed = () => {};

        mocks.allowance.mockResolvedValue(HALF);
        mocks.approve.mockReturnValue(
          new Promise((resolve) => {
            signed = resolve;
          })
        );
        mocks.waitForTransactionReceipt.mockReturnValue(new Promise(() => {}));

        const view = await toRevoke();

        mocks.waitForTransactionReceipt.mockReturnValue(new Promise(() => {}));
        await fireEvent.click(revokeIn(view));

        await vi.waitFor(() =>
          expect(statuses(view)).toContain("Revoke in your wallet")
        );
        expect(revokeIn(view)).toBeDisabled();

        signed(`0x${"dd".repeat(32)}`);

        await vi.waitFor(() =>
          expect(statuses(view)).toContain("Waiting for BNB Smart Chain…")
        );
        expect(revokeIn(view)).toBeDisabled();
      });

      it("hides what's approved now with the balances, as the form before it does", async () => {
        settingsStore.update((store) => ({ ...store, hideBalances: true }));
        mocks.allowance.mockResolvedValue(HALF);

        const view = await toRevoke();
        const review = /** @type {HTMLElement} */ (
          view.getByRole("heading", { name: "Review" }).parentElement
        );

        expect(review).toHaveTextContent("Approved now •••• BEP20 DUSK");
        expect(view.container).not.toHaveTextContent("0.5 BEP20");
      });

      it("leaves the history to a newer revoke's review as one sent from a screen since left goes through", async () => {
        /** @type {(hash: string) => void} */
        let signed = () => {};

        mocks.allowance.mockResolvedValue(HALF);
        mocks.approve.mockReturnValueOnce(
          new Promise((resolve) => {
            signed = resolve;
          })
        );

        const { page } = await import("$app/stores");
        const back = vi.spyOn(history, "back").mockImplementation(() => {});
        const at = (/** @type {object} */ state) =>
          /** @type {any} */ (page).set({ state });

        try {
          const first = await toRevoke();

          at({ routeRevoke: true });
          await fireEvent.click(revokeIn(first));
          await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalledOnce());

          // Its screen left, and another revoke reviewed, before it's signed.
          first.unmount();
          at({});

          const second = await toRevoke();

          at({ routeRevoke: true });
          signed(`0x${"dd".repeat(32)}`);
          await vi.waitFor(() =>
            expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(
              {},
              { chainId: 56, hash: `0x${"dd".repeat(32)}` }
            )
          );
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(back).not.toHaveBeenCalled();
          expect(
            second.getByRole("heading", { name: "Review" })
          ).toBeInTheDocument();
        } finally {
          at({});
          back.mockRestore();
        }
      });

      it("says the approval stands when it's declined in the wallet", async () => {
        mocks.allowance.mockResolvedValue(HALF);
        mocks.approve.mockRejectedValue(
          new Error("User rejected the request.")
        );

        const view = await toRevoke();

        await fireEvent.click(revokeIn(view));

        // Said on the review, which stays: it can be signed again.
        expect(await view.findByRole("alert")).toHaveTextContent(
          "You cancelled the revoke in your wallet. The approval stands."
        );
        expect(view.getByRole("heading", { name: "Review" })).toBeVisible();
        expect(view.container).toHaveTextContent("Approved now 0.5 BEP20 DUSK");
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

        expect(await view.findByRole("alert")).toHaveTextContent(
          "The approval wasn't revoked. Check your EVM wallet's activity before you try again."
        );
        await vi.waitFor(() =>
          expect(view.container).toHaveTextContent(
            "Approved now 0.5 BEP20 DUSK"
          )
        );
      });

      it("asks nothing of the wallet when the chain says it's gone already", async () => {
        mocks.allowance.mockResolvedValue(HALF);

        const view = await toRevoke();
        const { container, findByRole } = view;

        mocks.allowance.mockResolvedValue(0n);
        await fireEvent.click(revokeIn(view));

        expect(await findByRole("alert")).toHaveTextContent(
          "The approval is revoked."
        );
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
          })
        );
        await fireEvent.click(revokeIn(view));
        mocks.account?.update((now) => ({
          ...now,
          address: "0x3333333333333333333333333333333333333333",
        }));
        answer(HALF);

        expect(await findByRole("alert")).toHaveTextContent(
          "Your EVM wallet switched to another account, so nothing moved."
        );
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
            crypto.getRandomValues(new Uint8Array(64))
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
            crypto.getRandomValues(new Uint8Array(64))
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
          await view.findByRole("button", { name: "Revoke" })
        );
        await view.findByRole("heading", { name: "Review" });
        await fireEvent.click(revokeIn(view));

        expect(statuses(view)).not.toContain("Revoke in your wallet");
        expect(mocks.approve).not.toHaveBeenCalled();
      });
    });
  });

  describe("with something elsewhere only the public balance can pay to get at", () => {
    const keepForLater = { lux: 50_000_000n, why: "to unstake later" };

    it("keeps the fee for it on a transfer out's Max, and warns of an amount over that", async () => {
      connect({ address: EVM, chainId: 1 });

      const { findByRole, getByRole, getByText, queryByText } = render(Bridge, {
        ...props,
        keepForLater,
        linkedRoute: "dusk-to-bsc",
      });
      const amount = await findByRole("textbox", { name: "Amount, in DUSK" });

      await fireEvent.click(getByRole("button", { name: "Max" }));

      const fee =
        props.transferGasSettings.gasLimit * props.transferGasSettings.gasPrice;

      expect(/** @type {HTMLInputElement} */ (amount).value).toBe(
        formatDuskPlain(props.unshieldedBalance - fee - keepForLater.lux)
      );
      expect(queryByText(/too little to unstake/)).toBeNull();
      expect(
        getByText("Max keeps 0.05 DUSK to unstake later.")
      ).toBeInTheDocument();

      await fireEvent.input(amount, {
        target: { value: formatDuskPlain(props.unshieldedBalance - fee) },
      });

      expect(queryByText(/^Max keeps/)).toBeNull();

      expect(
        getByText("That leaves too little to unstake later.")
      ).toBeInTheDocument();
    });

    it("keeps what's said under the From panel's amount clear of the flip button over its edge", () => {
      const clears = styleRules(
        "../SwapCard/SwapCard.svelte",
        import.meta.url
      ).find(
        (rule) =>
          /\.swap-panel:has\(~ \.swap-flip\)/.test(rule.selector) &&
          rule.media === ""
      );
      // The flip button reaches 1.375rem into the panel above it.
      const reach = 1.375;

      for (const line of [".swap-note", ".swap-error", ".swap-recipient"]) {
        expect(clears?.selector).toContain(`> ${line}`);
      }
      expect(
        parseFloat(clears?.declarations["padding-bottom"] ?? "0")
      ).toBeGreaterThan(reach);
    });
  });

  describe("once it's sent, for as long as the screen is open", () => {
    it("gives the transaction, with a way to its explorer", async () => {
      connect({ address: EVM, chainId: 56 });
      mocks.executeSend.mockResolvedValue("ab".repeat(32));

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" })
      );
      await afterConfirmDelay();
      await fireEvent.click(view.getByRole("button", { name: "Send" }));
      await view.findByText("Sent");

      expect(view.getByRole("link", { name: /Dusk explorer/ })).toHaveAttribute(
        "href",
        expect.stringContaining("ab".repeat(32))
      );
    });

    const HASH = "ab".repeat(32);
    // A wallet may answer with any capitals: it's kept in lower case.
    const MIGRATED = `0x${"BB".repeat(32)}`;
    /** @param {string} id */
    const routeOf = (id) =>
      cardRoutes(networks.mainnet).find((r) => r.id === id);

    /** A transfer out of 2 DUSK, sent. */
    async function sendOut() {
      connect({ address: EVM, chainId: 56 });
      mocks.executeSend.mockResolvedValue(HASH);

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" })
      );
      await afterConfirmDelay();
      await fireEvent.click(view.getByRole("button", { name: "Send" }));
      await view.findByText("Sent");

      return view;
    }

    it("offers to tell when it arrives while it's on its way, asking the browser only as that's pressed", async () => {
      const requestPermission = vi.fn(async () => "granted");

      vi.stubGlobal(
        "Notification",
        Object.assign(function () {}, {
          permission: "default",
          requestPermission,
        })
      );

      const view = await sendOut();

      expect(requestPermission).not.toHaveBeenCalled();

      await fireEvent.click(
        view.getByRole("button", { name: "Tell me when it arrives" })
      );

      expect(requestPermission).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
      stopArrivalNotice();
    });

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

    it("says what arrived once a transfer out has, where a screen reader hears it", async () => {
      const { findByText, getByRole } = await sendOut();

      mocks.transfers?.set([out({ stage: "sent" })]);
      await tick();

      expect(document.querySelector(".route-result")).toHaveTextContent("Sent");
      expect(document.querySelector(".route-result")).toHaveTextContent(
        "1 DUSK arrives on BNB Smart Chain in about 10 hours."
      );

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);

      await findByText("Arrived");
      expect(document.querySelector(".route-result")).toHaveTextContent(
        "1 DUSK arrived on BNB Smart Chain."
      );
      expect(getByRole("link", { name: "View in activity" })).toHaveAttribute(
        "href",
        expect.stringContaining(HASH)
      );
    });

    it("offers to add DUSK to the wallet it arrived in, on its chain, and says it was added in its place; a refusal says nothing", async () => {
      const wallet = { name: "Test MetaMask", type: "injected", uid: "w1" };
      const { findByRole, getByText, queryByRole } = await sendOut();
      const offer = { name: "Add DUSK to Test MetaMask" };

      // Not before it arrives, nor to another account than it went to.
      connect({ address: EVM, chainId: 1, connector: wallet });
      mocks.transfers?.set([out({ stage: "sent" })]);
      await tick();
      expect(queryByRole("button", offer)).toBeNull();

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);
      connect({
        address: `0x${"33".repeat(20)}`,
        chainId: 1,
        connector: wallet,
      });
      await tick();
      expect(queryByRole("button", offer)).toBeNull();

      connect({ address: EVM, chainId: 1, connector: wallet });
      mocks.watchAsset.mockRejectedValueOnce(
        Object.assign(new Error("User rejected the request."), { code: 4001 })
      );
      await fireEvent.click(await findByRole("button", offer));

      await vi.waitFor(async () =>
        expect(await findByRole("button", offer)).toBeEnabled()
      );
      expect(document.querySelector(".route-result [role=alert]")).toBeNull();

      await fireEvent.click(await findByRole("button", offer));

      // On BNB Smart Chain, as its token there.
      expect(mocks.switchChain).toHaveBeenCalledWith({}, { chainId: 56 });
      expect(mocks.watchAsset).toHaveBeenLastCalledWith(
        {},
        {
          options: {
            address: routeOf("dusk-to-bsc")?.chain.token,
            decimals: 18,
            symbol: "DUSK",
          },
          type: "ERC20",
        }
      );
      await vi.waitFor(() => expect(queryByRole("button", offer)).toBeNull());
      expect(getByText("DUSK added to Test MetaMask.")).toHaveAttribute(
        "role",
        "status"
      );
      expect(
        JSON.parse(localStorage.getItem("web-wallet-evm-dusk-added") ?? "")
      ).toStrictEqual([`56:${EVM.toLowerCase()}`]);
    });

    it("offers nothing to a wallet over WalletConnect whose session doesn't take the request", async () => {
      const { queryByRole } = await sendOut();

      connect({
        address: EVM,
        chainId: 56,
        connector: {
          getProvider: async () => ({
            session: {
              namespaces: { eip155: { methods: ["eth_sendTransaction"] } },
            },
          }),
          name: "Phone wallet",
          type: "walletConnect",
          uid: "w2",
        },
      });
      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);
      await tick();
      await tick();

      expect(
        queryByRole("button", { name: "Add DUSK to Phone wallet" })
      ).toBeNull();
    });

    it("follows a transfer out whose answer got lost, never saying it was sent before the chain has it", async () => {
      const found = Promise.withResolvers();

      connect({ address: EVM, chainId: 56 });
      mocks.executeSend.mockRejectedValueOnce(
        outcomeUnknown(new TypeError("Failed to fetch"), HASH)
      );
      mocks.followTransaction.mockReturnValueOnce(found.promise);

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" })
      );
      await afterConfirmDelay();
      await fireEvent.click(view.getByRole("button", { name: "Send" }));

      await view.findByText("Not confirmed");

      const result = /** @type {HTMLElement} */ (
        document.querySelector(".route-result")
      );

      expect(result).toHaveTextContent(
        "2 DUSK to BNB Smart Chain It may have reached the network. Wait for it here before you send it again."
      );
      expect(result).not.toHaveTextContent("Sent");
      expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(mocks.followTransaction).toHaveBeenCalledWith(
        HASH,
        expect.anything()
      );

      found.resolve({ blockHeight: 9n, error: null, fee: 1n, timestamp: 1 });

      await view.findByText("Sent");
      expect(result).toHaveTextContent(
        "1 DUSK arrives on BNB Smart Chain in about 10 hours."
      );
    });

    it("says a migration is in the public balance once it's paid", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockResolvedValue(MIGRATED);
      mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      connect({ address: EVM, chainId: 1 });

      const { findByRole, findByText, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "ethereum-to-dusk",
      });

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "2,5" } }
      );
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await findByText("Migration sent");

      // Until it's paid, it says what's on its way.
      expect(document.querySelector(".route-result")).toHaveTextContent(
        "2.5 DUSK arrives on Dusk"
      );

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

      await findByText("Arrived");
      expect(document.querySelector(".route-result")).toHaveTextContent(
        "2.5 DUSK arrived in your public balance on Dusk."
      );
    });

    it("says so when a transfer takes twice its usual time, or fails", async () => {
      const { findByText } = await sendOut();

      mocks.transfers?.set([out({ at: Date.now() - 86_400_000 })]);

      await findByText("It's taking longer than usual.");

      mocks.transfers?.set([
        out({
          failure: "The bridge didn't take this transfer",
          stage: "failed",
        }),
      ]);

      await findByText("The bridge didn't take this transfer.");
      expect(document.querySelector(".route-result")).not.toHaveTextContent(
        "It usually arrives"
      );
    });

    it("keeps amounts hidden while balances are", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { findByText } = await sendOut();

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);

      await findByText("Arrived");
      expect(document.querySelector(".route-result")).toHaveTextContent(
        "It arrived on BNB Smart Chain."
      );
      expect(document.querySelector(".route-result")).not.toHaveTextContent(
        "1 DUSK"
      );
    });

    it("looks for the payout only while the screen is open", async () => {
      const { unmount } = await sendOut();

      mocks.transfers?.set([out({ stage: "sent" })]);
      await vi.waitFor(() => expect(mocks.followTransfers).toHaveBeenCalled());

      unmount();
      mocks.followTransfers.mockClear();
      mocks.transfers?.set([out({ hash: "cd".repeat(32), stage: "sent" })]);
      await tick();

      expect(mocks.followTransfers).not.toHaveBeenCalled();
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
        { target: { value: "1" } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review migration" })
      );

      return view;
    }

    const ethereum = () => networks.mainnet.routes.chains.ethereum;

    it("names the contract an approval lets take the amount, and the token", async () => {
      mocks.allowance.mockResolvedValue(0n);

      const { container, findByText } = await reviewMigration();

      await findByText("Approve the amount, then migrate, in your wallet");

      const contract = /** @type {any} */ (
        networks.mainnet.routes.migrations.find((m) => m.chain === "ethereum")
      ).contract;

      expect(container).toHaveTextContent(
        "Approval You allow the migration contract to take exactly this amount. Nothing moves yet."
      );

      // One click away, for whoever checks them against the wallet.
      const check = /** @type {HTMLDetailsElement} */ (
        container.querySelector("details.route-review__check")
      );

      expect(check.open).toBe(false);
      expect(check).toHaveTextContent("Addresses to check");
      expect(check).toHaveTextContent(`Ethereum, chain ID 1`);
      expect(check).toHaveTextContent(`Migration contract ${contract}`);
      expect(check).toHaveTextContent(`ERC20 DUSK ${ethereum().token}`);
      expect(check).toHaveTextContent(
        "Public on Ethereum and Dusk, and linked:"
      );
    });

    it("says what the wallet holds for the network fee, and asks nothing without any", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getNativeBalance.mockResolvedValueOnce(12_345n * 10n ** 14n);

      let view = await reviewMigration();

      await vi.waitFor(() =>
        expect(view.container).toHaveTextContent(
          "Network fees About 0.00012 ETH, from your 1.2345 ETH. No bridge fee"
        )
      );
      expect(view.container).toHaveTextContent("Arrives 1 DUSK on Dusk in");
      expect(mocks.getNativeBalance).toHaveBeenCalledWith(EVM, 1);
      cleanup();

      mocks.getNativeBalance.mockResolvedValueOnce(0n);
      view = await reviewMigration();

      expect(
        await view.findByRole("button", { name: "No ETH for the network fee" })
      ).toBeDisabled();
      expect(view.queryByRole("button", { name: "Migrate" })).toBeNull();
    });

    it("keeps what the wallet holds hidden while balances are", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getNativeBalance.mockResolvedValueOnce(12_345n * 10n ** 14n);

      const { container, findByRole } = await reviewMigration();

      await findByRole("button", { name: "Migrate" });
      await vi.waitFor(() =>
        expect(container).toHaveTextContent(
          /Network fees About 0\.00012 ETH, from your \S+ ETH/
        )
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
        })
      );

      const { findByRole, getByRole, queryByRole } = await reviewMigration();

      await fireEvent.click(await findByRole("button", { name: "Back" }));
      mocks.getNativeBalance.mockResolvedValueOnce(DUSK * DUSK);
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await findByRole("button", { name: "Migrate" });

      answerOld(0n);
      await tick();
      await tick();

      expect(
        queryByRole("button", { name: "No ETH for the network fee" })
      ).toBeNull();
    });

    it("says nothing it doesn't know when the balance can't be read", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getNativeBalance.mockRejectedValueOnce(new Error("No answer."));

      const { container, findByRole } = await reviewMigration();

      await findByRole("button", { name: "Migrate" });
      await vi.waitFor(() =>
        expect(container).toHaveTextContent(
          "Network fees On Ethereum, as your wallet shows"
        )
      );
    });

    it("names the bridge's account a transfer out goes through", async () => {
      connect({ address: EVM, chainId: 56 });

      const { container, findByRole, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "dusk-to-bsc",
      });

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } }
      );
      await fireEvent.click(getByRole("button", { name: "Review bridge" }));

      const service = /** @type {any} */ (
        networks.mainnet.routes.services.find((s) => s.chain === "bsc")
      );

      expect(container).toHaveTextContent(
        "Through The bridge's account, which pays your address"
      );

      const check = /** @type {HTMLDetailsElement} */ (
        container.querySelector("details.route-review__check")
      );

      expect(check.open).toBe(false);
      expect(check).toHaveTextContent(`Bridge account ${service.account}`);
      expect(check).toHaveTextContent(`Memo ${EVM}`);
      expect(check).toHaveTextContent(
        "Public on Dusk and BNB Smart Chain, and linked:"
      );
    });

    it("says why an amount with too many decimals won't do, on both routes", async () => {
      connect({ address: EVM, chainId: 56 });

      const out = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await out.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "1.0123456789" } }
      );

      expect(
        out.getByRole("button", { name: "Use at most 9 decimals" })
      ).toBeDisabled();
      cleanup();

      const view = await reviewMigration();

      await fireEvent.click(await view.findByRole("button", { name: "Back" }));
      await fireEvent.input(
        view.getByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "1.0123456789" } }
      );

      expect(
        view.getByRole("button", { name: "Use at most 9 decimals" })
      ).toBeDisabled();
    });

    it("goes back to the form on a phone's Back, and forward to the review, with what's filled in", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);

      const { page } = await import("$app/stores");
      const at = (/** @type {object} */ state) =>
        /** @type {any} */ (page).set({ state });
      const { findByRole, getByRole, queryByRole } = await reviewMigration();

      await findByRole("button", { name: "Migrate" });
      expect(mocks.pushState).toHaveBeenCalledWith("", { routeReview: true });

      at({ routeReview: true });
      await tick();
      expect(getByRole("button", { name: "Migrate" })).toBeInTheDocument();

      at({});
      await tick();
      expect(queryByRole("button", { name: "Migrate" })).toBeNull();
      expect(
        getByRole("textbox", { name: "Amount, in ERC20 DUSK" })
      ).toHaveValue("1");

      at({ routeReview: true });
      await tick();
      expect(
        await findByRole("button", { name: "Migrate" })
      ).toBeInTheDocument();
      at({});
    });

    it("takes the review's step in the history along when an account change closes it, and adds none on top", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);

      const { page } = await import("$app/stores");
      const back = vi.spyOn(history, "back").mockImplementation(() => {});
      const at = (/** @type {object} */ state) =>
        /** @type {any} */ (page).set({ state });
      const { findByRole } = await reviewMigration();

      await findByRole("button", { name: "Migrate" });
      at({ routeReview: true });
      await tick();

      connect({
        address: "0x3333333333333333333333333333333333333333",
        chainId: 1,
      });
      await findByRole("alert");
      expect(back).toHaveBeenCalledOnce();

      // With the marker still there, a new review uses it, stacking none.
      mocks.pushState.mockClear();
      await fireEvent.click(
        await findByRole("button", { name: "Review migration" })
      );

      expect(mocks.pushState).not.toHaveBeenCalled();
      at({});
      back.mockRestore();
    });

    it("keeps focus on the swap once the direction changes, and says which it is", async () => {
      connect({ address: EVM, chainId: 56 });

      const { findByRole, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "dusk-to-bsc",
      });

      await findByRole("textbox", { name: "Amount, in DUSK" });
      await fireEvent.click(getByRole("button", { name: "Swap From and To" }));
      await findByRole("textbox", { name: "Amount, in BEP20 DUSK" });

      expect(document.activeElement).toBe(
        getByRole("button", { name: "Swap From and To" })
      );
      expect(document.body).toHaveTextContent("From BNB Smart Chain to Dusk");
    });

    it("says why an amount is refused where a screen reader hears it, not only on the button", async () => {
      connect({ address: EVM, chainId: 56 });

      const { container, findByRole } = render(Bridge, {
        ...props,
        linkedRoute: "dusk-to-bsc",
      });

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "0.5" } }
      );

      expect(container.querySelector(".route-amount-reason")).toHaveTextContent(
        "Send more than the 1 DUSK bridge fee"
      );
      expect(container.querySelector("output")).toHaveAttribute(
        "aria-live",
        "off"
      );
    });

    it("starts a new transfer from the Bridge tab once one is sent", async () => {
      connect({ address: EVM, chainId: 56 });
      mocks.executeSend.mockResolvedValue("ab".repeat(32));

      const { findByRole, findByText, getByRole, getAllByRole } = render(
        Bridge,
        { ...props, linkedRoute: "dusk-to-bsc" }
      );

      await fireEvent.input(
        await findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } }
      );
      await fireEvent.click(getByRole("button", { name: "Review bridge" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: "Send" }));
      await findByText("Sent");

      const tab = getAllByRole("link", { name: "Bridge" })[0];

      tab.addEventListener("click", (event) => event.preventDefault());
      await fireEvent.click(tab);

      expect(
        await findByRole("textbox", { name: "Amount, in DUSK" })
      ).toHaveValue("");
    });
  });

  describe("when the wallet or its account changes course", () => {
    const REFUSED = new Error(
      "An error occurred while approving the DUSK: User rejected the request."
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
        { target: { value: "1" } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review migration" })
      );
      await view.findByRole("button", { name: "Migrate" });
      await afterConfirmDelay();

      return view;
    }

    it("goes back to the review, in plain words, when the approval is refused", async () => {
      mocks.allowance.mockResolvedValue(0n);
      mocks.approve.mockRejectedValue(REFUSED);

      const { container, findByRole, getByRole, queryByText } =
        await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      expect(await findByRole("alert")).toHaveTextContent(
        "You cancelled the approval in your wallet. Nothing moved."
      );
      expect(getByRole("button", { name: "Migrate" })).toBeInTheDocument();
      expect(queryByText("The migration didn't go through")).toBeNull();
      expect(container).not.toHaveTextContent("Request Arguments");
      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("says the approval stands when only the migration is refused, and asks only for that next", async () => {
      mocks.allowance.mockResolvedValueOnce(0n);
      mocks.approve.mockResolvedValue(`0x${"aa".repeat(32)}`);
      mocks.migrate.mockRejectedValueOnce(
        new Error("User rejected the request.")
      );

      const { container, findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      expect(await findByRole("alert")).toHaveTextContent(
        "You cancelled the migration in your wallet. The approval went through, so next time it only asks to migrate. Nothing moved."
      );

      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      await fireEvent.click(getByRole("button", { name: "Back" }));
      await fireEvent.click(getByRole("button", { name: "Review migration" }));
      await findByRole("button", { name: "Migrate" });

      await vi.waitFor(() =>
        expect(container).toHaveTextContent("Migrate, in your wallet")
      );
    });

    it("never offers to send it again when the wallet's answer got lost, as it may have gone out", async () => {
      const { outcomeUnknown } = await import("$lib/transactions");

      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockRejectedValue(
        outcomeUnknown(new Error("The request took too long to respond."))
      );

      const { container, findByText, getByRole, queryByRole } =
        await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      await findByText("Not confirmed");
      expect(container).toHaveTextContent(
        "It may have reached the network. Check your EVM wallet and Activity before you send it again."
      );
      expect(queryByRole("button", { name: "Back" })).toBeNull();
      expect(queryByRole("button", { name: "Migrate" })).toBeNull();
    });

    it("offers to try again when it failed before it went out", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockRejectedValueOnce(
        new Error("The contract would revert.")
      );

      const { findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await fireEvent.click(await findByRole("button", { name: "Try again" }));

      expect(
        await findByRole("button", { name: "Migrate" })
      ).toBeInTheDocument();
    });

    describe("what the wallet answers with an error and no hash", () => {
      /** The wallet's refusal of a migrate its allowance no longer covers. */
      const usedUp = () =>
        outcomeUnknown(
          new Error(
            "execution reverted: BEP20: transfer amount exceeds allowance"
          )
        );

      it("says nothing was sent and why, and offers to approve again once the allowance was used up elsewhere", async () => {
        // Enough as it's reviewed and sent; used up by another tab as it's signed.
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          throw usedUp();
        });

        const { container, findByRole, findByText, getByRole, queryByText } =
          await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        expect(
          await findByText(
            "Your approval no longer covers this amount, so nothing was sent. Approve again to migrate it."
          )
        ).toBeInTheDocument();
        expect(container).toHaveTextContent("The migration didn't go through");
        expect(queryByText("Not confirmed")).toBeNull();
        expect(container).not.toHaveTextContent("may have reached");
        expect(container.querySelector("details")).toHaveTextContent(
          "BEP20: transfer amount exceeds allowance"
        );

        await fireEvent.click(getByRole("button", { name: "Approve again" }));

        // The review again, which now has the approval as a step of its own.
        expect(
          await findByRole("button", { name: "Migrate" })
        ).toBeInTheDocument();
        await vi.waitFor(() =>
          expect(container).toHaveTextContent(
            "Approve the amount, then migrate, in your wallet"
          )
        );
        expect(mocks.migrate).toHaveBeenCalledOnce();
      });

      it("says why where the allowance still covers it, and offers to try again, not to approve", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockRejectedValueOnce(
          outcomeUnknown(new Error("execution reverted: Paused"))
        );

        const { findByRole, findByText, getByRole, queryByRole } =
          await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        expect(
          await findByText(
            "The network would refuse it, so nothing was sent. See Details for why."
          )
        ).toBeInTheDocument();
        expect(queryByRole("button", { name: "Approve again" })).toBeNull();

        await fireEvent.click(getByRole("button", { name: "Try again" }));

        expect(
          await findByRole("button", { name: "Migrate" })
        ).toBeInTheDocument();
      });

      it("says the same of a check that fails before the wallet is asked", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          throw new Error(
            'The contract function "migrate" reverted with the following reason:\nBEP20: transfer amount exceeds allowance'
          );
        });

        const { findByRole, getByRole } = await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        expect(
          await findByRole("button", { name: "Approve again" })
        ).toBeInTheDocument();
      });

      it("keeps to Not confirmed for what proves nothing, however the allowance reads", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockImplementation(async () => {
          mocks.allowance.mockResolvedValue(0n);

          throw outcomeUnknown(new Error("Internal JSON-RPC error."));
        });

        const { container, findByText, getByRole, queryByRole } =
          await toReview();

        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        await findByText("Not confirmed");

        expect(container).toHaveTextContent(
          "It may have reached the network. Check your EVM wallet and Activity before you send it again."
        );
        expect(queryByRole("button", { name: "Approve again" })).toBeNull();
        expect(queryByRole("button", { name: "Try again" })).toBeNull();
        expect(container.querySelector(".route-result a")).toHaveTextContent(
          "Home"
        );
      });

      it("says it isn't known once the chain was asked about what was sent, whatever it says", async () => {
        mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
        mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);

        const { container, findByText, getByRole, queryByRole } =
          await toReview();

        mocks.waitForTransactionReceipt.mockRejectedValue(
          new Error("execution reverted")
        );
        await fireEvent.click(getByRole("button", { name: "Migrate" }));

        await findByText("Not confirmed");

        expect(container).toHaveTextContent(
          "It was sent to Ethereum. Check Activity before you try again."
        );
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
        })
      );

      const { getByRole, unmount } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalled());

      unmount();
      signed(`0x${"aa".repeat(32)}`);
      await vi.waitFor(() =>
        expect(mocks.waitForTransactionReceipt).toHaveBeenCalled()
      );
      await tick();
      await tick();

      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("asks for the route's chain on a review the wallet left, and sends nothing until it's back", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);
      mocks.switchChain.mockRejectedValueOnce(
        new Error("User rejected the request.")
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
        await findByRole("button", { name: "Migrate" })
      ).toBeInTheDocument();
      expect(getByRole("heading", { name: "Review" })).toBeInTheDocument();
      expect(mocks.migrate).not.toHaveBeenCalled();
    });

    it("forgets why a review closed once the amount changes", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);

      const { findByRole, getByRole, queryByRole } = await toReview();

      connect({
        address: "0x3333333333333333333333333333333333333333",
        chainId: 1,
      });
      await findByRole("alert");
      await fireEvent.input(
        getByRole("textbox", { name: "Amount, in ERC20 DUSK" }),
        { target: { value: "2" } }
      );

      expect(queryByRole("alert")).toBeNull();
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

      expect(await findByRole("alert")).toHaveTextContent(
        "Your EVM wallet switched to another account, so nothing moved. Review again."
      );
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(
        getByRole("button", { name: "Review migration" })
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

    it("closes a review when the account changes under it, and says why", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);

      const { findByRole, getByRole, queryByRole } = await toReview();

      connect({
        address: "0x3333333333333333333333333333333333333333",
        chainId: 1,
      });

      expect(await findByRole("alert")).toHaveTextContent(
        "Your EVM wallet switched to another account, so nothing moved. Review again."
      );
      expect(queryByRole("button", { name: "Migrate" })).toBeNull();
      expect(
        getByRole("button", { name: "Review migration" })
      ).toBeInTheDocument();
    });

    it("closes the review of a transfer out when the address it pays changes", async () => {
      connect({ address: EVM, chainId: 56 });

      const view = render(Bridge, { ...props, linkedRoute: "dusk-to-bsc" });

      await fireEvent.input(
        await view.findByRole("textbox", { name: "Amount, in DUSK" }),
        { target: { value: "2" } }
      );
      await fireEvent.click(
        view.getByRole("button", { name: "Review bridge" })
      );
      await view.findByRole("button", { name: "Send" });

      connect({
        address: "0x3333333333333333333333333333333333333333",
        chainId: 56,
      });

      expect(await view.findByRole("alert")).toHaveTextContent(
        "Your EVM wallet switched to another account, so nothing was sent. Review again."
      );
      expect(view.queryByRole("button", { name: "Send" })).toBeNull();
    });

    it("offers to ask again when the wallet refuses to change chain, and asks", async () => {
      mocks.getBalanceOfCoin.mockResolvedValue(5n * DUSK * DUSK);
      mocks.switchChain.mockRejectedValueOnce(
        new Error("User rejected the request.")
      );
      connect({ address: EVM, chainId: 1 });

      const { askToSwitch } = await import("$lib/bridge/chainSwitch");
      const { findByRole, getByRole } = render(Bridge, {
        ...props,
        linkedRoute: "bsc-to-dusk",
      });

      await askToSwitch(56);

      const again = await findByRole("button", {
        name: "Switch to BNB Smart Chain",
      });

      expect(again).toBeEnabled();

      // Waiting for the wallet to answer.
      mocks.switchChain.mockReturnValueOnce(new Promise(() => {}));
      await fireEvent.click(again);

      expect(mocks.switchChain).toHaveBeenCalledTimes(2);
      await vi.waitFor(() =>
        expect(
          getByRole("button", { name: "Switching to BNB Smart Chain…" })
        ).toBeDisabled()
      );

      // Asking again takes over from the ask left without an answer.
      await askToSwitch(56);

      expect(
        await findByRole("button", { name: "Switch to BNB Smart Chain" })
      ).toBeEnabled();
    });

    it("moves focus to the review, and says each step where a screen reader hears it", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockResolvedValue(`0x${"cc".repeat(32)}`);

      const { container, getByRole } = await toReview();

      expect(document.activeElement).toBe(
        getByRole("heading", { name: "Review" })
      );

      await fireEvent.click(getByRole("button", { name: "Migrate" }));

      await vi.waitFor(() =>
        expect(container.querySelector(".route-result")).toHaveTextContent(
          "Migration sent"
        )
      );
    });
  });

  it("says in plain words why a transfer out failed before it went out, with the node's own words under Details", async () => {
    const reason = `Tx ${"ab".repeat(32)} not accepted: gas price lower than minimum 1`;

    mocks.executeSend.mockRejectedValue(new Error(reason));
    connect({ address: EVM, chainId: 1 });

    const { container, findByText, getByRole } = render(Bridge, props);

    await fireEvent.input(getByRole("textbox", { name: "Amount, in DUSK" }), {
      target: { value: "2" },
    });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Send" }));

    expect(
      await findByText(
        "The network refused it: the gas price is under its minimum. Raise it and try again."
      )
    ).toBeInTheDocument();
    expect(container).toHaveTextContent("The transfer didn't go through");
    expect(container.querySelector("details summary")).toHaveTextContent(
      /^Details$/
    );
    expect(container.querySelector("details")).toHaveTextContent(reason);

    // Nothing went out: back to the review, with what's filled in.
    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(container.querySelector(".route-review__line")).toHaveTextContent(
      "2 DUSK sent"
    );
    expect(mocks.executeSend).toHaveBeenCalledOnce();
  });

  it("offers no Try again on a transfer out when it may have gone out", async () => {
    mocks.executeSend.mockRejectedValue(
      outcomeUnknown(new TypeError("Failed to fetch"))
    );
    connect({ address: EVM, chainId: 1 });

    const { findByText, getByRole, queryByRole } = render(Bridge, props);

    await fireEvent.input(getByRole("textbox", { name: "Amount, in DUSK" }), {
      target: { value: "2" },
    });
    await fireEvent.click(getByRole("button", { name: "Review bridge" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: "Send" }));

    expect(await findByText("Not confirmed")).toBeInTheDocument();
    expect(queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says testnet's Sepolia routes aren't running, as a link to one opens it", async () => {
    setNodeNetwork(networks.testnet);

    const { container, getByRole } = render(Bridge, {
      ...props,
      linkedRoute: "ethereum-to-dusk",
    });

    expect(container.querySelector(".swap-route summary")).toHaveTextContent(
      "Not running on testnet right now"
    );
    expect(
      getByRole("button", { name: "Not running right now" })
    ).toBeDisabled();
    expect(
      getByRole("textbox", { name: "Amount, in ERC20 DUSK" })
    ).toBeDisabled();
  });
});
