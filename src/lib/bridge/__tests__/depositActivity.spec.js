import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chainId: 5678 }));

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: { id: mocks.chainId },
}));

import {
  getRememberedDepositActivity,
  hydrateDepositActivity,
  pendingDepositAmountLux,
  rememberDepositTransaction,
  updateDepositTransaction,
} from "$lib/bridge/depositActivityStorage";
import {
  depositStageLabel,
  depositStageMessage,
  depositStageProgress,
  isDepositDelayed,
} from "$lib/bridge/depositLifecycle";

const account = "0x2222222222222222222222222222222222222222";
const otherAccount = "0x3333333333333333333333333333333333333333";
const depositHash = `0x${"44".repeat(32)}`;
const otherHash = `0x${"55".repeat(32)}`;

describe("DuskEVM deposit activity", () => {
  beforeEach(() => {
    localStorage.clear();
    hydrateDepositActivity();
  });

  it("persists deposits by destination account and preserves their amounts", () => {
    rememberDepositTransaction(depositHash, {
      account,
      amountLux: 2_500_000_000n,
      amountWei: 2_500_000_000_000_000_000n,
      createdAt: 1_000,
    });
    rememberDepositTransaction(otherHash, {
      account: otherAccount,
      amountLux: 1_000_000_000n,
      amountWei: 1_000_000_000_000_000_000n,
      createdAt: 2_000,
    });

    expect(getRememberedDepositActivity(account)).toEqual([
      expect.objectContaining({
        account,
        amountLux: "2500000000",
        amountWei: "2500000000000000000",
        createdAt: 1_000,
        stage: "l1_pending",
        transactionHash: depositHash,
      }),
    ]);
    expect(getRememberedDepositActivity(otherAccount)).toHaveLength(1);
  });

  it("counts only nonterminal deposits as incoming DuskEVM balance", () => {
    rememberDepositTransaction(depositHash, {
      account,
      amountLux: 2_500_000_000n,
    });
    rememberDepositTransaction(otherHash, {
      account,
      amountLux: 1_000_000_000n,
    });

    expect(pendingDepositAmountLux(account)).toBe(3_500_000_000n);

    updateDepositTransaction(depositHash, { stage: "completed" });
    expect(pendingDepositAmountLux(account)).toBe(1_000_000_000n);

    updateDepositTransaction(otherHash, {
      failureLayer: "l1",
      stage: "failed",
    });
    expect(pendingDepositAmountLux(account)).toBe(0n);
  });

  it("retains the last canonical state when tracking is temporarily unavailable", () => {
    rememberDepositTransaction(depositHash, { account });
    updateDepositTransaction(depositHash, {
      l1BlockHeight: "42",
      l2TransactionHash: `0x${"66".repeat(32)}`,
      stage: "l2_pending",
    });
    updateDepositTransaction(depositHash, {
      trackingError: "RPC unavailable",
    });

    expect(getRememberedDepositActivity(account)[0]).toEqual(
      expect.objectContaining({
        l1BlockHeight: "42",
        stage: "l2_pending",
        trackingError: "RPC unavailable",
      })
    );
  });

  it("presents pending, delayed, and layer-specific failure states", () => {
    const pending = {
      createdAt: Date.now(),
      l1ConfirmedAt: Date.now(),
      stage: "l2_pending",
    };
    const pendingForDelay = {
      createdAt: 1_000,
      l1ConfirmedAt: 300_000,
      stage: "l2_pending",
    };

    expect(depositStageLabel(pending)).toBe("Bridging");
    expect(depositStageProgress(pending)).toBe(2);
    expect(isDepositDelayed(pendingForDelay, 599_999)).toBe(false);
    expect(isDepositDelayed(pendingForDelay, 600_000)).toBe(true);
    expect(
      isDepositDelayed({ createdAt: 1_000, stage: "l2_pending" }, 301_000)
    ).toBe(true);
    expect(
      depositStageMessage({
        failureLayer: "l1",
        stage: "failed",
        statusMessage: "Low-level SDK failure",
      })
    ).toContain("did not enter the bridge");
    expect(
      depositStageMessage({
        failureLayer: "l2",
        stage: "failed",
        statusMessage: "Low-level SDK failure",
      })
    ).toContain("bridge recovery");
  });
});
