import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { getBalance, watchBlocks } from "@wagmi/core";

import { account } from "$lib/web3/walletConnection";

import { BridgeContract } from "..";

const { CONNECTED, DISCONNECTED, unwatchBlocks } = vi.hoisted(() => ({
  CONNECTED: {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 745,
    isConnected: true,
  },
  DISCONNECTED: {
    address: undefined,
    chainId: undefined,
    isConnected: false,
  },
  unwatchBlocks: vi.fn(),
}));

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  estimateGas: vi.fn(() => Promise.resolve(21_000n)),
  getBalance: vi.fn(() =>
    Promise.resolve({ decimals: 18, formatted: "1", symbol: "DUSK", value: 1n })
  ),
  getGasPrice: vi.fn(() => Promise.resolve(1n)),
  switchChain: vi.fn(() => Promise.resolve()),
  watchBlocks: vi.fn(() => unwatchBlocks),
  watchChainId: vi.fn(() => () => {}),
}));

vi.mock("$lib/bridge/bridgeTimes", async () => {
  const { writable } = await import("svelte/store");
  const times = writable({});

  return {
    default: { load: vi.fn(), subscribe: times.subscribe },
  };
});

vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");

  return {
    account: writable(DISCONNECTED),
    duskEvm: {
      blockExplorers: { default: { url: "https://explorer.example.test" } },
      id: 745,
      nativeCurrency: { decimals: 18 },
    },
    modal: { open: vi.fn() },
    wagmiConfig: {},
  };
});

/** @param {any} next */
const setAccount = (next) =>
  /** @type {import("svelte/store").Writable<any>} */ (account).set(next);

describe("BridgeContract", () => {
  afterEach(() => {
    cleanup();
    setAccount(DISCONNECTED);
    vi.clearAllMocks();
  });

  it("should ask for no block while no EVM wallet is connected, and read the balance on each block while one is", async () => {
    render(BridgeContract);
    await tick();

    expect(watchBlocks).not.toHaveBeenCalled();

    setAccount(CONNECTED);
    await tick();

    expect(watchBlocks).toHaveBeenCalledTimes(1);

    // A new block: the connected wallet's balance.
    await vi
      .mocked(watchBlocks)
      .mock.calls[0][1].onBlock(/** @type {any} */ ({}), undefined);

    expect(getBalance).toHaveBeenCalledWith(
      {},
      { address: CONNECTED.address, chainId: CONNECTED.chainId }
    );

    // The account changes but stays connected: the same watch.
    setAccount({ ...CONNECTED, address: `0x${"3".repeat(40)}` });
    await tick();

    expect(watchBlocks).toHaveBeenCalledTimes(1);
    expect(unwatchBlocks).not.toHaveBeenCalled();

    setAccount(DISCONNECTED);
    await tick();

    expect(unwatchBlocks).toHaveBeenCalledTimes(1);
  });

  it("should stop asking for blocks when the page closes", async () => {
    setAccount(CONNECTED);

    const { unmount } = render(BridgeContract);

    await tick();

    expect(watchBlocks).toHaveBeenCalledTimes(1);

    unmount();

    expect(unwatchBlocks).toHaveBeenCalledTimes(1);
  });
});
