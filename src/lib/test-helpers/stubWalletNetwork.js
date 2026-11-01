import { vi } from "vitest";
import { Bookkeeper } from "@dusk/w3sper";

import { networkStore } from "$lib/stores";

/**
 * The node's answers a wallet that opens asks for, so that wallets can be
 * unlocked, added and switched between in a test, with no node.
 */
export default function stubWalletNetwork() {
  vi.spyOn(Bookkeeper.prototype, "minimumStake", "get").mockResolvedValue(1n);
  vi.spyOn(Bookkeeper.prototype, "balance").mockResolvedValue(
    /** @type {any} */ ({ nonce: 0n, spendable: 0n, value: 0n })
  );
  vi.spyOn(Bookkeeper.prototype, "stakeInfo").mockResolvedValue(
    /** @type {any} */ ({ amount: null, faults: 0, hardFaults: 0, reward: 0n })
  );
  vi.spyOn(networkStore, "checkBlock").mockResolvedValue(true);
  vi.spyOn(networkStore, "getBlockHashByHeight").mockResolvedValue("hash");
  vi.spyOn(networkStore, "getLastFinalizedBlockHeight").mockResolvedValue(1n);
  vi.spyOn(networkStore, "getCurrentBlockHeight").mockResolvedValue(123n);
}
