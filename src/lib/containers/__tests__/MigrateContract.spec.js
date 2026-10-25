import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { settingsStore } from "$lib/stores";

import { MigrateContract } from "..";

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {typeof import("@wagmi/core")} */ (await importOriginal()),
  switchChain: vi.fn(() => Promise.resolve()),
}));

vi.mock("$lib/web3/migration", () => ({
  getBalanceOfCoin: vi.fn(() => Promise.resolve(5_000_000_000_000_000_000n)),
}));

vi.mock("$lib/web3/walletConnection", async () => {
  const { readable } = await import("svelte/store");

  return {
    account: readable({
      address: "0x2222222222222222222222222222222222222222",
      chainId: 11155111,
      isConnected: true,
    }),
    modal: { open: vi.fn(), subscribeEvents: vi.fn() },
    wagmiConfig: {},
    walletDisconnect: vi.fn(),
  };
});

describe("MigrateContract", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("should hide the connected wallet's balance while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(MigrateContract, {
      migrationNetwork: "testnet",
    });

    await vi.waitFor(() =>
      expect(
        container.querySelector(".migrate__token-balance")
      ).toHaveTextContent("Balance: •••• hidden ERC-20 DUSK")
    );
  });
});
