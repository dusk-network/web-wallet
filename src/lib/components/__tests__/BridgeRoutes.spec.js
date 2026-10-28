import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";
import { tick } from "svelte";

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
  executeSend: vi.fn(),
  getBalanceOfCoin: vi.fn(),
  migrate: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("$lib/bridge/bridgeTimes", async () => {
  const { readable } = await import("svelte/store");

  return {
    default: { load: vi.fn(), subscribe: readable({ chain: null }).subscribe },
  };
});

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
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("$lib/web3/migration", () => ({
  allowance: mocks.allowance,
  approve: mocks.approve,
  getBalanceOfCoin: mocks.getBalanceOfCoin,
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
    localStorage.clear();
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

    await fireEvent.click(getByRole("button", { name: "Migrate" }));
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

    const wei = 2_500_000_000n * DUSK;

    expect(mocks.approve).toHaveBeenCalledWith(
      migration.contract,
      networks.mainnet.routes.chains.bsc.token,
      wei,
      56
    );
    expect(mocks.migrate).toHaveBeenCalledWith(
      wei,
      56,
      ACCOUNT,
      migration.contract
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

    await fireEvent.click(getByRole("button", { name: "Migrate" }));
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalled());

    expect(mocks.approve).not.toHaveBeenCalled();
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
