import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import {
  depositActivityStore,
  rememberDepositTransaction,
} from "../depositActivityStorage";
import { forgetBridgeRecords } from "../forgetBridgeRecords";
import {
  rememberWithdrawalTransaction,
  withdrawalActivityStore,
} from "../withdrawalActivityStorage";

vi.mock("$lib/web3/walletConnection", () => ({ duskEvm: { id: 310 } }));

describe("forgetBridgeRecords", () => {
  const TIMES = `${CONFIG.LOCAL_STORAGE_APP_KEY}-bridge-times-testnet-${"14".repeat(32)}`;
  const RATE = `${CONFIG.LOCAL_STORAGE_APP_KEY}-native-reward-rate-testnet`;

  it("should forget the deposits and withdrawals kept here, and with times the bridge's times too", () => {
    rememberDepositTransaction("ab".repeat(32), {
      account: `0x${"22".repeat(20)}`,
    });
    rememberWithdrawalTransaction(`0x${"44".repeat(32)}`);
    localStorage.setItem(TIMES, "{}");
    localStorage.setItem(RATE, "{}");

    expect(localStorage.getItem("dusk-evm:last-withdrawal-tx-hash")).not.toBe(
      null
    );

    forgetBridgeRecords();

    expect(
      Object.keys(localStorage).filter((key) => key.startsWith("dusk-evm:"))
    ).toStrictEqual([]);
    expect(get(depositActivityStore)).toStrictEqual([]);
    expect(get(withdrawalActivityStore)).toStrictEqual([]);
    expect(localStorage.getItem(TIMES)).toBe("{}");

    forgetBridgeRecords({ times: true });

    expect(localStorage.getItem(TIMES)).toBeNull();
    // A network's reward rate is no wallet's, nor the bridge's.
    expect(localStorage.getItem(RATE)).toBe("{}");
    localStorage.clear();
  });
});
