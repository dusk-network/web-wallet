import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";
import { tick } from "svelte";

import { cardRoutes } from "$lib/bridge/cardRoutes";
import { CONFIRM_DELAY } from "$lib/dusk/motion";
import { afterConfirmDelay } from "$lib/dusk/test-helpers";
import { settingsStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

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
  getBalanceOfCoin: vi.fn(),
  getNativeBalance: vi.fn(async () => DUSK * DUSK),
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

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  switchChain: mocks.switchChain,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("$lib/web3/migration", () => ({
  allowance: mocks.allowance,
  approve: mocks.approve,
  getBalanceOfCoin: mocks.getBalanceOfCoin,
  getNativeBalance: mocks.getNativeBalance,
  migrate: mocks.migrate,
}));

vi.mock("$lib/contracts", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  executeSend: mocks.executeSend,
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
    localStorage.clear();
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

    // On another chain, the wallet is moved to BNB Smart Chain first.
    connect({ address: EVM, chainId: 1 });
    await tick();

    expect(
      getByRole("button", { name: "Switching to BNB Smart Chain…" })
    ).toBeDisabled();

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

  describe("once it's sent, for as long as the screen is open", () => {
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

      expect(getByRole("status")).toHaveTextContent("Sent");
      expect(getByRole("status")).toHaveTextContent("It usually arrives");

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);

      await findByText("Arrived");
      expect(getByRole("status")).toHaveTextContent(
        "1 DUSK arrived on BNB Smart Chain."
      );
      expect(getByRole("link", { name: "View in activity" })).toHaveAttribute(
        "href",
        expect.stringContaining(HASH)
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
      expect(getByRole("status")).toHaveTextContent(
        "2.5 DUSK arrived in your public balance on Dusk."
      );
    });

    it("says so when a transfer takes twice its usual time, or fails", async () => {
      const { findByText, getByRole } = await sendOut();

      mocks.transfers?.set([out({ at: Date.now() - 86_400_000 })]);

      await findByText("It's taking longer than usual.");

      mocks.transfers?.set([
        out({
          failure: "The bridge didn't take this transfer",
          stage: "failed",
        }),
      ]);

      await findByText("The bridge didn't take this transfer.");
      expect(getByRole("status")).not.toHaveTextContent("It usually arrives");
    });

    it("keeps amounts hidden while balances are", async () => {
      settingsStore.update((store) => ({ ...store, hideBalances: true }));

      const { findByText, getByRole } = await sendOut();

      mocks.transfers?.set([out({ payout: "0xcc", stage: "arrived" })]);

      await findByText("Arrived");
      expect(getByRole("status")).toHaveTextContent(
        "It arrived on BNB Smart Chain."
      );
      expect(getByRole("status")).not.toHaveTextContent("1 DUSK");
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
        `Approval The migration contract, for exactly this amount ${contract}`
      );
      expect(container).toHaveTextContent(
        `Token ERC20 DUSK ${ethereum().token}`
      );
    });

    it("says what the wallet holds for the network fee, and asks nothing without any", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.getNativeBalance.mockResolvedValueOnce(12_345n * 10n ** 14n);

      let view = await reviewMigration();

      await vi.waitFor(() =>
        expect(view.container).toHaveTextContent(
          "Network fees You have 1.2345 ETH for them"
        )
      );
      expect(mocks.getNativeBalance).toHaveBeenCalledWith(EVM, 1);
      cleanup();

      mocks.getNativeBalance.mockResolvedValueOnce(0n);
      view = await reviewMigration();

      expect(
        await view.findByRole("button", { name: "No ETH for the network fee" })
      ).toBeDisabled();
      expect(view.queryByRole("button", { name: "Migrate" })).toBeNull();
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
        `Through The bridge's account on Dusk, with your address as the memo ${service.account}`
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

    it("offers to go back when it failed before it went out", async () => {
      mocks.allowance.mockResolvedValue(5n * DUSK * DUSK);
      mocks.migrate.mockRejectedValueOnce(
        new Error("The contract would revert.")
      );

      const { findByRole, getByRole } = await toReview();

      await fireEvent.click(getByRole("button", { name: "Migrate" }));
      await fireEvent.click(await findByRole("button", { name: "Back" }));

      expect(
        await findByRole("button", { name: "Migrate" })
      ).toBeInTheDocument();
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

      mocks.switchChain.mockResolvedValueOnce({ id: 56 });
      await fireEvent.click(again);

      expect(mocks.switchChain).toHaveBeenCalledTimes(2);
      await vi.waitFor(() =>
        expect(
          getByRole("button", { name: "Switching to BNB Smart Chain…" })
        ).toBeDisabled()
      );
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
        expect(container.querySelector("[role='status']")).toHaveTextContent(
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
