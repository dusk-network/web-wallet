import { describe, expect, it, vi } from "vitest";
import { createAppKit } from "@reown/appkit";
import { networks } from "@dusk-network/networks";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { evmChains, startWalletConnection } from "../walletConnection";

describe("walletConnection", () => {
  it("should start nothing until a page asks for it: no requests to Reown, WalletConnect or Coinbase", () => {
    expect(vi.mocked(createAppKit)).not.toHaveBeenCalled();
  });

  it("should list the chains the node's network's routes reach, DuskEVM first, each with its file's RPC", () => {
    setNodeNetwork(networks.testnet);

    expect(
      evmChains().map(({ id, name, rpcUrls }) => [
        id,
        name,
        rpcUrls.default.http[0],
      ])
    ).toStrictEqual([
      [745, "DuskEVM Testnet", "https://rpc.testnet.evm.dusk.network"],
      [745745, "BSC test chain", "https://anvil.testnet.dusk.network"],
    ]);

    // No DuskEVM on mainnet yet: BNB Smart Chain and Ethereum.
    setNodeNetwork(networks.mainnet);

    expect(evmChains().map(({ id }) => id)).toStrictEqual([56, 1]);

    setNodeNetwork(null);

    expect(evmChains()).toStrictEqual([]);
  });

  it("should never offer wallets a DuskEVM chain the network's routes don't reach, whatever is set", () => {
    vi.stubEnv("VITE_EVM_CHAIN_ID", "744");
    vi.stubEnv("VITE_EVM_BRIDGE_RPC_URL", "https://rpc.evm.example.test");
    setNodeNetwork(networks.mainnet);

    expect(evmChains().map(({ id }) => id)).toStrictEqual([56, 1]);

    vi.unstubAllEnvs();
  });

  it("should give a wallet adding a chain the network's own RPC, not WalletConnect's with this project's ID", async () => {
    vi.resetModules();

    const { setNodeNetwork: setNet } = await import("$lib/stores/nodeNetwork");
    const { startWalletConnection: start } =
      await import("../walletConnection");

    setNet(networks.mainnet);
    vi.mocked(createAppKit).mockClear();
    await start();

    expect(
      vi.mocked(createAppKit).mock.calls[0][0].customRpcUrls
    ).toStrictEqual({
      "eip155:1": [{ url: networks.mainnet.routes.chains.ethereum.rpcUrl }],
      "eip155:56": [{ url: networks.mainnet.routes.chains.bsc.rpcUrl }],
    });
    vi.mocked(createAppKit).mockClear();
  });

  it("should keep the connected address from WalletConnect's name lookup", async () => {
    vi.resetModules();

    const { setNodeNetwork: setNet } = await import("$lib/stores/nodeNetwork");
    const { startWalletConnection: start } =
      await import("../walletConnection");

    setNet(networks.mainnet);
    vi.mocked(createAppKit).mockClear();

    const kit = /** @type {any} */ ({ subscribeEvents: vi.fn() });

    vi.mocked(createAppKit).mockReturnValueOnce(kit);
    await start();

    expect(await kit.fetchIdentity({ address: "0x1" })).toStrictEqual({
      avatar: null,
      name: null,
    });
    vi.mocked(createAppKit).mockClear();
  });

  it("should then offer wallets only, without analytics or the Coinbase SDKs' telemetry, once", async () => {
    setNodeNetwork(networks.testnet);
    await startWalletConnection();
    await startWalletConnection();

    expect(vi.mocked(createAppKit)).toHaveBeenCalledOnce();
    expect(vi.mocked(createAppKit).mock.calls[0][0]).toMatchObject({
      // AppKit's own sheet for an unknown chain can't be closed: the card asks.
      allowUnsupportedChain: true,
      enableBaseAccount: false,
      enableCoinbase: false,
      features: { analytics: false, email: false, socials: false },
    });
  });
});
