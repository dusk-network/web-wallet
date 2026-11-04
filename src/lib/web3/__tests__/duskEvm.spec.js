import { afterEach, describe, expect, it, vi } from "vitest";
import { readable } from "svelte/store";
import { networks } from "@dusk-network/networks";

/**
 * The DuskEVM module on a node of `net`.
 *
 * @param {import("@dusk-network/networks").Network | null} net
 */
async function on(net) {
  vi.resetModules();
  vi.doMock("$lib/stores/nodeNetwork", () => ({ default: readable(net) }));

  return await import("../duskEvm");
}

describe("DuskEVM", () => {
  afterEach(() => {
    vi.doUnmock("$lib/stores/nodeNetwork");
    vi.unstubAllEnvs();
  });

  it("is the node's network's, as its file has it", async () => {
    const evm = /** @type {NonNullable<typeof networks.testnet.duskEvm>} */ (
      networks.testnet.duskEvm
    );
    const { duskEvm, duskEvmAdapterUrl, duskEvmContractId, duskEvmDriverUrl } =
      await on(networks.testnet);

    expect(duskEvm).toMatchObject({
      blockExplorers: { default: { url: evm.explorerUrl } },
      contracts: {
        L2StandardBridge: { address: evm.predeploys.l2StandardBridge },
      },
      id: 745,
      name: evm.name,
      nativeCurrency: { decimals: 18, symbol: "DUSK" },
      rpcUrls: { default: { http: [evm.rpcUrl] } },
    });
    expect(duskEvmContractId("optimism_portal")).toBe(
      evm.contracts.optimism_portal.contractId
    );
    expect(duskEvmDriverUrl("optimismPortal")).toBe(
      "/drivers/optimism_portal_dd_opt.wasm"
    );
    // Its adapter answers at /l1 on its RPC's host.
    expect(duskEvmAdapterUrl()).toBe(`${evm.rpcUrl}/l1`);
  });

  it("leaves mainnet without DuskEVM until its file has the routes, whatever is set", async () => {
    vi.stubEnv("VITE_EVM_CHAIN_ID", "744");
    vi.stubEnv("VITE_EVM_BRIDGE_RPC_URL", "https://rpc.evm.example.test");
    vi.stubEnv(
      "VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL",
      "https://explorer.evm.example.test"
    );
    vi.stubEnv(
      "VITE_EVM_BRIDGE_CONTRACT_ADDRESS",
      "0x4200000000000000000000000000000000000010"
    );

    const {
      duskEvm,
      duskEvmAdapterUrl,
      duskEvmContractId,
      duskEvmDriverUrl,
      duskEvmExplorerTx,
      duskEvmNetwork,
    } = await on(networks.mainnet);

    expect(duskEvmNetwork()).toBeNull();
    expect(duskEvm.id).toBeUndefined();
    expect(duskEvm.rpcUrls.default.http).toStrictEqual([undefined]);
    expect(duskEvm.contracts.L2StandardBridge.address).toBeUndefined();
    expect(duskEvmAdapterUrl()).toBeUndefined();
    expect(duskEvmExplorerTx("0xabc")).toBeNull();
    expect(duskEvmContractId("optimism_portal", "ab".repeat(32))).toBe("");
    expect(duskEvmDriverUrl("optimismPortal", "/drivers/set.wasm")).toBe("");

    // The day its file has the routes, what's set counts again.
    const { testnet } = networks;
    const live = await on({
      ...networks.mainnet,
      duskEvm: testnet.duskEvm,
      routes: { ...networks.mainnet.routes, duskEvm: testnet.routes.duskEvm },
    });

    expect(live.duskEvm.id).toBe(744);
  });

  it("has no DuskEVM from a file that has its contracts, but not its routes", async () => {
    const { duskEvm, duskEvmNetwork } = await on({
      ...networks.testnet,
      routes: { ...networks.testnet.routes, duskEvm: [] },
    });

    expect(duskEvmNetwork()).toBeNull();
    expect(duskEvm.id).toBeUndefined();
  });

  it("takes what's set on a devnet or a local node, to set one up", async () => {
    vi.stubEnv("VITE_EVM_CHAIN_ID", "310");
    vi.stubEnv("VITE_EVM_BRIDGE_RPC_URL", "https://l2.example.test");

    for (const net of [networks.devnet, null]) {
      const { duskEvm } = await on(net);

      expect(duskEvm.id).toBe(310);
      expect(duskEvm.rpcUrls.default.http).toStrictEqual([
        "https://l2.example.test",
      ]);
    }
  });

  it("takes what's set for local work over the network's", async () => {
    vi.stubEnv("VITE_EVM_CHAIN_ID", "310");
    vi.stubEnv("VITE_EVM_BRIDGE_RPC_URL", "https://l2.example.test");
    vi.stubEnv("VITE_EVM_L1_BRIDGE_RPC_URL", "https://adapter.example.test");

    const { duskEvm, duskEvmAdapterUrl, duskEvmContractId } = await on(
      networks.testnet
    );

    expect(duskEvm.id).toBe(310);
    expect(duskEvm.rpcUrls.default.http).toStrictEqual([
      "https://l2.example.test",
    ]);
    expect(duskEvmAdapterUrl()).toBe("https://adapter.example.test");
    expect(duskEvmContractId("optimism_portal", `0x${"AB".repeat(32)}`)).toBe(
      "ab".repeat(32)
    );
  });

  it("takes its adapter from the network's file, unless one is set", async () => {
    const evm = /** @type {NonNullable<typeof networks.testnet.duskEvm>} */ (
      networks.testnet.duskEvm
    );
    const net = {
      ...networks.testnet,
      duskEvm: { ...evm, l1AdapterUrl: "https://adapter.example.test/rpc" },
    };

    expect((await on(net)).duskEvmAdapterUrl()).toBe(
      "https://adapter.example.test/rpc"
    );

    vi.stubEnv("VITE_EVM_L1_BRIDGE_RPC_URL", "https://local.example.test/l1");

    expect((await on(net)).duskEvmAdapterUrl()).toBe(
      "https://local.example.test/l1"
    );
  });

  it("finds its adapter at /l1 on the RPC it uses: the one set, with or without a network file", async () => {
    vi.stubEnv("VITE_EVM_BRIDGE_RPC_URL", "https://l2.example.test/");

    for (const net of [networks.testnet, null]) {
      const { duskEvmAdapterUrl } = await on(net);

      expect(duskEvmAdapterUrl()).toBe("https://l2.example.test/l1");
    }
  });

  it("is none on a network without it, nor on a chain without a file", async () => {
    for (const net of [networks.mainnet, null]) {
      const { duskEvm, duskEvmAdapterUrl, duskEvmContractId, duskEvmNetwork } =
        await on(net);

      expect(duskEvmNetwork()).toBeNull();
      expect(duskEvm.id).toBeUndefined();
      expect(duskEvmAdapterUrl()).toBeUndefined();
      expect(duskEvmContractId("optimism_portal")).toBe("");
    }
  });
});
