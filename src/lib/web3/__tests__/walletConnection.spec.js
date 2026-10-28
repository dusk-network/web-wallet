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
      [11155111, "Sepolia", "https://ethereum-sepolia-rpc.publicnode.com"],
    ]);

    // No DuskEVM on mainnet yet: BNB Smart Chain and Ethereum.
    setNodeNetwork(networks.mainnet);

    expect(evmChains().map(({ id }) => id)).toStrictEqual([56, 1]);

    setNodeNetwork(null);

    expect(evmChains()).toStrictEqual([]);
  });

  it("should then offer wallets only, without analytics or the Coinbase SDKs' telemetry, once", async () => {
    setNodeNetwork(networks.testnet);
    await startWalletConnection();
    await startWalletConnection();

    expect(vi.mocked(createAppKit)).toHaveBeenCalledOnce();
    expect(vi.mocked(createAppKit).mock.calls[0][0]).toMatchObject({
      enableBaseAccount: false,
      enableCoinbase: false,
      features: { analytics: false, email: false, socials: false },
    });
  });
});
