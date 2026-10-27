import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { settingsStore } from "$lib/stores";

import { account } from "$lib/web3/walletConnection";

import { MigrateContract } from "..";

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {typeof import("@wagmi/core")} */ (await importOriginal()),
  switchChain: vi.fn(() => Promise.resolve()),
}));

vi.mock("$lib/web3/migration", () => ({
  getBalanceOfCoin: vi.fn(() => Promise.resolve(5_000_000_000_000_000_000n)),
}));

const { CONNECTED } = vi.hoisted(() => ({
  CONNECTED: {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 11155111,
    isConnected: true,
  },
}));

vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");

  return {
    account: writable(CONNECTED),
    modal: { open: vi.fn(), subscribeEvents: vi.fn() },
    wagmiConfig: {},
    walletDisconnect: vi.fn(),
  };
});

describe("MigrateContract", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
    /** @type {import("svelte/store").Writable<any>} */ (account).set(
      CONNECTED
    );
  });

  it("should hide the connected wallet's balance while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(MigrateContract, {
      migrationNetwork: "testnet",
    });

    await vi.waitFor(() =>
      expect(container.querySelector("#migrate-balance")).toHaveTextContent(
        "•••• hidden DUSK"
      )
    );
  });

  it("should say what a migration does, from Ethereum or BNB Smart Chain, with one button", async () => {
    const { container, getByLabelText, getByRole, queryByText } = render(
      MigrateContract,
      { migrationNetwork: "testnet" }
    );

    // No line saying what the card is.
    expect(queryByText(/^Moves DUSK/)).toBeNull();
    expect(queryByText(/ERC-20|BEP-20/)).toBeNull();
    expect(getByRole("link", { name: "Home" })).toBeInTheDocument();

    await vi.waitFor(() =>
      expect(getByLabelText("Amount")).toHaveAccessibleDescription(
        "Balance on Ethereum: 5 DUSK"
      )
    );
    expect(getByRole("button", { name: "Enter an amount" })).toBeDisabled();

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "2" },
    });

    expect(container.querySelector("output")).toHaveTextContent("2");
    expect(getByRole("button", { name: "Start the migration" })).toBeEnabled();

    await fireEvent.click(
      getByRole("button", { name: "From: Ethereum. Choose the network" })
    );
    await fireEvent.click(getByRole("option", { name: /BNB Smart Chain/ }));

    expect(
      getByRole("button", { name: "From: BNB Smart Chain. Choose the network" })
    ).toBeInTheDocument();
    expect(getByLabelText("Amount")).toHaveValue("");
  });

  it("should say how long a migration takes from each chain on its network, and nothing where that isn't known", async () => {
    const summary = (/** @type {HTMLElement} */ container) =>
      container.querySelector(".swap-route summary")?.textContent?.trim();
    const mainnet = render(MigrateContract, { migrationNetwork: "mainnet" });

    expect(summary(mainnet.container)).toBe(
      "~70 min · approve, then migrate, in your Ethereum wallet"
    );

    await fireEvent.click(
      mainnet.getByRole("button", {
        name: "From: Ethereum. Choose the network",
      })
    );
    await fireEvent.click(
      mainnet.getByRole("option", { name: /BNB Smart Chain/ })
    );

    expect(summary(mainnet.container)).toBe(
      "~1 hour · approve, then migrate, in your BNB Smart Chain wallet"
    );
    expect(mainnet.queryByText(/a while|a few minutes/)).toBeNull();
    cleanup();

    const testnet = render(MigrateContract, { migrationNetwork: "testnet" });

    expect(summary(testnet.container)).toBe(
      "Approve, then migrate, in your Ethereum wallet"
    );
  });

  it("should read the balance of a wallet that connects, or comes back, while it shows", async () => {
    /** @type {import("svelte/store").Writable<any>} */ (account).set({
      isConnected: false,
    });

    const { getByLabelText, getByRole } = render(MigrateContract, {
      migrationNetwork: "testnet",
    });

    expect(getByRole("button", { name: "Connect to Ethereum" })).toBeEnabled();

    /** @type {import("svelte/store").Writable<any>} */ (account).set(
      CONNECTED
    );

    await vi.waitFor(() =>
      expect(getByLabelText("Amount")).toHaveAccessibleDescription(
        "Balance on Ethereum: 5 DUSK"
      )
    );
  });
});
