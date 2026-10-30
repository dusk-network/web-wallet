import { afterEach, describe, expect, it, vi } from "vitest";

import { networks } from "@dusk-network/networks";

import { contractLabel } from "../knownContracts";

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

describe("contractLabel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should name the contracts the wallet knows, as their network's file does", () => {
    const portal = networks.testnet.duskEvm?.contracts.optimism_portal;

    expect(contractLabel(STORE, "testnet")).toBe("Dusk Domains");
    expect(contractLabel(STORE, "mainnet")).toBe("");
    expect(contractLabel(portal?.contractId, "testnet")).toBe(
      "DuskEVM bridge portal"
    );
    expect(contractLabel(networks.mainnet.sozu?.hub, "mainnet")).toBe(
      "Sozu hub"
    );
    expect(
      contractLabel(networks.testnet.sozu?.fallbacks.pool, "testnet")
    ).toBe("Sozu pool");
    expect(contractLabel("ab".repeat(32))).toBe("");
    expect(contractLabel("")).toBe("");

    // The bridge's contracts set for local work.
    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", "cd".repeat(32));
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "ef".repeat(32));

    expect(contractLabel(`0x${"CD".repeat(32)}`)).toBe("DuskEVM bridge");
    expect(contractLabel("ef".repeat(32))).toBe("DuskEVM bridge");
  });
});
