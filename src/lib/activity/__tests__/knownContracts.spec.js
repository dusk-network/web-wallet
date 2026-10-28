import { afterEach, describe, expect, it, vi } from "vitest";

import releases from "$lib/dusk-domains/dusk-domains-releases.json";
import { SOZU_POOLS } from "$lib/sozu/config";

import {
  DUSK_DOMAINS_CONTRACTS,
  contractLabel,
  knownCall,
} from "../knownContracts";

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

describe("knownCall", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should know Dusk Domains' contracts as its release names them", () => {
    for (const network of /** @type {const} */ (["mainnet", "testnet"])) {
      const release = releases[network];

      expect([...DUSK_DOMAINS_CONTRACTS[network]].sort()).toStrictEqual(
        [...release.contracts.map((c) => c.contractId), release.lens.contractId]
          .map((id) => id.toLowerCase().replace(/^0x/, ""))
          .sort()
      );
    }
  });

  it("should say what a call to Dusk Domains did, on its network only", () => {
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Registered a .dusk name",
    });
    expect(knownCall({ contractId: `0x${STORE}`, fnName: "commit" })).toEqual({
      app: "Dusk Domains",
      label: "Reserved a .dusk name",
    });
    expect(
      knownCall({ contractId: STORE, fnName: "other" }, "testnet")
    ).toEqual({
      app: "Dusk Domains",
      label: "Dusk Domains",
    });
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "mainnet")
    ).toBeNull();
    expect(
      knownCall({ contractId: STORE, fnName: "register" }, "devnet")
    ).toBeNull();
    expect(
      knownCall({ contractId: "ab".repeat(32), fnName: "register" })
    ).toBeNull();
  });

  it("should name the contracts the wallet knows", () => {
    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", "cd".repeat(32));
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "ef".repeat(32));

    expect(contractLabel(STORE, "testnet")).toBe("Dusk Domains");
    expect(contractLabel(`0x${"CD".repeat(32)}`)).toBe("DuskEVM bridge");
    expect(contractLabel("ef".repeat(32))).toBe("DuskEVM bridge");
    expect(contractLabel([...SOZU_POOLS][0])).toBe("Sozu");
    expect(contractLabel("ab".repeat(32))).toBe("");
    expect(contractLabel("")).toBe("");
  });
});
