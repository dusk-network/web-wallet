import { afterEach, describe, expect, it, vi } from "vitest";
import { depositCall } from "@dusk-network/networks/duskevm";
import { networks } from "@dusk-network/networks";

import { decodeBridgeCall, isBridgeContract } from "../bridgeCalls";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

const hex = (/** @type {Uint8Array} */ bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("a deposit read back from the history", () => {
  const net = networks.testnet;
  const to = "0x3E5B8223e638CB414BEF8CF95393460cA1C3a11d";
  const call = /** @type {NonNullable<ReturnType<typeof depositCall>>} */ (
    depositCall(net, { amountLux: 100_000_000n, to })
  );
  const local = "cd".repeat(32);

  afterEach(() => {
    vi.unstubAllEnvs();
    setNodeNetwork(null);
  });

  it("reads one to the network's bridge", () => {
    setNodeNetwork(net);

    expect(
      decodeBridgeCall({
        contractId: call.contractId,
        data: hex(call.fnArgs),
        fnName: call.fnName,
      })
    ).toStrictEqual({ amount: "100000000", kind: "deposit", to });
  });

  it("reads one to the bridge set for a local deployment, as the wallet sends it there", () => {
    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", local);
    setNodeNetwork(net);

    expect(isBridgeContract(local)).toBe(true);
    expect(
      decodeBridgeCall({
        contractId: local,
        data: hex(call.fnArgs),
        fnName: call.fnName,
      })
    ).toStrictEqual({ amount: "100000000", kind: "deposit", to });
  });
});
