import { afterEach, describe, expect, it, vi } from "vitest";

import { networks } from "@dusk-network/networks";

import { contractLabel, knownCall } from "../knownContracts";

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

describe("knownCall", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should say what a call to Dusk Domains did, on its network only", () => {
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Registered a .dusk name",
    });
    expect(
      knownCall({ contractId: `0x${STORE}`, fnName: "commit" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Name reservation (step 1 of 2)",
    });
    expect(
      knownCall({ contractId: STORE, fnName: "other" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Dusk Domains",
    });
    // Both ways of changing a name's records read the same.
    for (const fnName of ["mutate_records", "replace_records"]) {
      expect(knownCall({ contractId: STORE, fnName }, "testnet")?.label).toBe(
        "Changed a .dusk name's records"
      );
    }
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "mainnet")
    ).toBeNull();
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "devnet")
    ).toBeNull();
    expect(knownCall({ contractId: STORE, fnName: "register" })).toBeNull();
    expect(
      knownCall({ contractId: "ab".repeat(32), fnName: "register" }, "testnet")
    ).toBeNull();
  });

  it("should say which name a reservation was for, once its registration revealed it", () => {
    expect(
      knownCall(
        { contractId: STORE, fnName: "commit", reservedName: "alice.dusk" },
        "testnet"
      )
    ).toEqual({ app: "Dusk Domains", label: "Reserved alice.dusk" });
    // Only a reservation's.
    expect(
      knownCall(
        { contractId: STORE, fnName: "renew", reservedName: "alice.dusk" },
        "testnet"
      )?.label
    ).toBe("Renewed a .dusk name");
  });

  it("should say which name a registration registered, once that's read", () => {
    expect(
      knownCall(
        { contractId: STORE, fnName: "register", registeredName: "alice.dusk" },
        "testnet"
      )
    ).toEqual({ app: "Dusk Domains", label: "Registered alice.dusk" });
    // Not read, or not readable: as before.
    for (const registeredName of [undefined, null]) {
      expect(
        knownCall(
          { contractId: STORE, fnName: "register", registeredName },
          "testnet"
        )?.label
      ).toBe("Registered a .dusk name");
    }
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
