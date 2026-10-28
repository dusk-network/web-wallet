import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import {
  getBalance,
  switchChain,
  watchBlocks,
  watchChainId,
} from "@wagmi/core";

import { account } from "$lib/web3/walletConnection";

import { BridgeContract } from "..";

const { CONNECTED, DISCONNECTED, evm, SEPOLIA } = vi.hoisted(() => {
  /** The chains the stand-in config knows: DuskEVM and Sepolia. */
  const CHAINS = [745, 11_155_111];

  /**
   * A stand-in for the wagmi config, for wagmi's own `watchBlocks`: a
   * client watches the blocks of the chain asked for, else of the config's
   * chain, which follows the wallet's as wagmi's does.
   */
  const state = { chainId: 745 };

  /** @type {Set<(next: typeof state) => void>} */
  const listeners = new Set();

  /** @type {{ chainId: number, stopped: boolean }[]} */
  const watchers = [];

  const config = {
    _internal: { syncConnectedChain: true },

    /** @param {{ chainId?: number }} [options] */
    getClient: ({ chainId } = {}) => {
      if (chainId && !CHAINS.includes(chainId)) {
        throw new Error("Chain not configured.");
      }

      return {
        watchBlocks: () => {
          const watcher = {
            chainId: chainId ?? state.chainId,
            stopped: false,
          };

          watchers.push(watcher);

          return () => {
            watcher.stopped = true;
          };
        },
      };
    },

    /**
     * @param {(next: typeof state) => number} select
     * @param {(selected: number) => void} listener
     */
    subscribe: (select, listener) => {
      /** @param {typeof state} next */
      const onChange = (next) => listener(select(next));

      listeners.add(onChange);

      return () => listeners.delete(onChange);
    },
  };

  return {
    CONNECTED: {
      address: "0x2222222222222222222222222222222222222222",
      chain: { id: 745 },
      chainId: 745,
      isConnected: true,
    },
    DISCONNECTED: {
      address: undefined,
      chain: undefined,
      chainId: undefined,
      isConnected: false,
    },
    evm: {
      /** The block watchers still asking. */
      asking: () => watchers.filter((watcher) => !watcher.stopped),
      config,
      reset() {
        watchers.length = 0;
        listeners.clear();
        state.chainId = 745;
      },

      /**
       * The wallet moves to another chain, and the config with it.
       *
       * @param {number} chainId
       */
      setChain(chainId) {
        if (chainId !== state.chainId) {
          state.chainId = chainId;
          listeners.forEach((onChange) => onChange(state));
        }
      },
    },
    SEPOLIA: CHAINS[1],
  };
});

vi.mock("@wagmi/core", async (importOriginal) => {
  /** @type {typeof import("@wagmi/core")} */
  const wagmi = await importOriginal();

  return {
    ...wagmi,
    estimateGas: vi.fn(() => Promise.resolve(21_000n)),
    getBalance: vi.fn(() =>
      Promise.resolve({
        decimals: 18,
        formatted: "1",
        symbol: "DUSK",
        value: 1n,
      })
    ),
    getGasPrice: vi.fn(() => Promise.resolve(1n)),
    switchChain: vi.fn(() => Promise.resolve()),
    watchBlocks: vi.fn(wagmi.watchBlocks),
    watchChainId: vi.fn(() => () => {}),
  };
});

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
    wagmiConfig: evm.config,
  };
});

/** @param {any} next */
const setAccount = (next) =>
  /** @type {import("svelte/store").Writable<any>} */ (account).set(next);

describe("BridgeContract", () => {
  afterEach(() => {
    cleanup();
    setAccount(DISCONNECTED);
    evm.reset();
    vi.clearAllMocks();
  });

  it("should ask for no block while no EVM wallet is connected, and read the balance on each block while one is", async () => {
    render(BridgeContract);
    await tick();

    expect(watchBlocks).not.toHaveBeenCalled();

    setAccount(CONNECTED);
    await tick();

    expect(evm.asking()).toEqual([
      { chainId: CONNECTED.chainId, stopped: false },
    ]);

    // A new block: the connected wallet's balance.
    await vi
      .mocked(watchBlocks)
      .mock.calls[0][1].onBlock(/** @type {any} */ ({}), undefined);

    expect(getBalance).toHaveBeenCalledWith(evm.config, {
      address: CONNECTED.address,
      chainId: CONNECTED.chainId,
    });

    // The account changes but stays connected: the same watch.
    setAccount({ ...CONNECTED, address: `0x${"3".repeat(40)}` });
    await tick();

    expect(watchBlocks).toHaveBeenCalledTimes(1);
    expect(evm.asking()).toHaveLength(1);

    setAccount(DISCONNECTED);
    await tick();

    expect(evm.asking()).toEqual([]);
  });

  it("should stop asking for blocks when the page closes", async () => {
    setAccount(CONNECTED);

    const { unmount } = render(BridgeContract);

    await tick();

    expect(evm.asking()).toHaveLength(1);

    unmount();

    expect(evm.asking()).toEqual([]);
  });

  it.each(["the wallet disconnects", "the page closes"])(
    "should stop asking for blocks when %s after a wallet that came back on another chain moved to DuskEVM",
    async (end) => {
      vi.mocked(switchChain).mockImplementationOnce(async (_, { chainId }) => {
        evm.setChain(chainId);
        setAccount({ ...CONNECTED, chain: { id: chainId }, chainId });

        return /** @type {any} */ ({ id: chainId });
      });

      evm.setChain(SEPOLIA);
      setAccount({ ...CONNECTED, chain: { id: SEPOLIA }, chainId: SEPOLIA });

      const { unmount } = render(BridgeContract);

      await tick();

      expect(switchChain).toHaveBeenCalledWith(evm.config, {
        chainId: CONNECTED.chainId,
      });
      expect(evm.asking()).toEqual([
        { chainId: CONNECTED.chainId, stopped: false },
      ]);

      if (end === "the wallet disconnects") {
        setAccount(DISCONNECTED);
        await tick();
      } else {
        unmount();
      }

      expect(evm.asking()).toEqual([]);
    }
  );

  it("should follow the wallet's chain only while one is connected, the connection unloaded until then", async () => {
    const unwatch = vi.fn();

    vi.mocked(watchChainId).mockReturnValue(unwatch);

    const { unmount } = render(BridgeContract);

    await tick();

    expect(watchChainId).not.toHaveBeenCalled();

    setAccount(CONNECTED);
    await tick();

    expect(watchChainId).toHaveBeenCalledOnce();

    // Another account, still connected: the same watch.
    setAccount({ ...CONNECTED, address: `0x${"3".repeat(40)}` });
    await tick();

    expect(watchChainId).toHaveBeenCalledOnce();

    setAccount(DISCONNECTED);
    await tick();

    expect(unwatch).toHaveBeenCalledOnce();

    unmount();
  });

  it("should ask for no block while the wallet is on a chain the page doesn't know", async () => {
    setAccount({ ...CONNECTED, chain: undefined, chainId: 42_161 });

    render(BridgeContract);
    await tick();

    expect(watchBlocks).not.toHaveBeenCalled();

    setAccount(CONNECTED);
    await tick();

    expect(evm.asking()).toEqual([
      { chainId: CONNECTED.chainId, stopped: false },
    ]);
  });
});
