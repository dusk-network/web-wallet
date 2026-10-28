import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDuskTransactionExecution: vi.fn(),
  loadL2BlockTime: vi.fn(),
  loadWithdrawalStatus: vi.fn(),
}));

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: { id: 310 },
}));

vi.mock("$lib/bridge/withdrawals", () => ({
  loadDuskTransactionExecution: mocks.loadDuskTransactionExecution,
  loadL2BlockTime: mocks.loadL2BlockTime,
  loadWithdrawalStatus: mocks.loadWithdrawalStatus,
}));

const account = "0x2222222222222222222222222222222222222222";
const transactionHash = /** @type {`0x${string}`} */ (`0x${"44".repeat(32)}`);
const withdrawalHash = /** @type {`0x${string}`} */ (`0x${"55".repeat(32)}`);
const duskTransactionHash = "66".repeat(32);

/** @type {typeof import("../withdrawalTracking").refreshWithdrawalTransaction} */
let refreshWithdrawalTransaction;
/** @type {typeof import("../withdrawalTracking").resumeWithdrawalTracking} */
let resumeWithdrawalTracking;
/** @type {typeof import("../withdrawalTracking").trackWithdrawalTransaction} */
let trackWithdrawalTransaction;
/** @type {typeof import("../withdrawalActivityStorage").getRememberedWithdrawalTransaction} */
let getRememberedWithdrawalTransaction;
/** @type {typeof import("../withdrawalActivityStorage").rememberWithdrawalTransaction} */
let rememberWithdrawalTransaction;
/** @type {typeof import("../withdrawalActivityStorage").updateWithdrawalTransaction} */
let updateWithdrawalTransaction;

function readyToProveStatus() {
  return {
    blockNumber: 4421n,
    stage: "ready_to_prove",
    transactionHash,
    withdrawalHash,
  };
}

describe("DuskEVM withdrawal tracking", () => {
  beforeAll(async () => {
    ({
      refreshWithdrawalTransaction,
      resumeWithdrawalTracking,
      trackWithdrawalTransaction,
    } = await import("../withdrawalTracking"));
    ({
      getRememberedWithdrawalTransaction,
      rememberWithdrawalTransaction,
      updateWithdrawalTransaction,
    } = await import("../withdrawalActivityStorage"));
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.loadDuskTransactionExecution.mockReset();
    mocks.loadL2BlockTime.mockReset();
    mocks.loadL2BlockTime.mockResolvedValue("2026-09-25T11:51:09.000Z");
    mocks.loadWithdrawalStatus.mockReset();
    rememberWithdrawalTransaction(transactionHash, { account });
  });

  it("takes when a withdrawal was sent from its DuskEVM block, and its amount from its message, once", async () => {
    const lookedUpAt =
      getRememberedWithdrawalTransaction(transactionHash)?.timestamp;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      blockNumber: 2_580_123n,
      withdrawal: { value: 10n ** 19n },
    });

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        amountWei: "10000000000000000000",
        sentAt: "2026-09-25T11:51:09.000Z",
        timestamp: lookedUpAt,
      })
    );
    expect(mocks.loadL2BlockTime).toHaveBeenCalledExactlyOnceWith(2_580_123n);

    await refreshWithdrawalTransaction(transactionHash);

    expect(mocks.loadL2BlockTime).toHaveBeenCalledOnce();
    expect(getRememberedWithdrawalTransaction(transactionHash)?.sentAt).toBe(
      "2026-09-25T11:51:09.000Z"
    );
  });

  it("reads the block's time again at the next refresh when it couldn't", async () => {
    mocks.loadWithdrawalStatus.mockResolvedValue(readyToProveStatus());
    mocks.loadL2BlockTime.mockRejectedValueOnce(new Error("RPC unavailable"));

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({ sentAt: null, stage: "ready_to_prove" })
    );

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({ sentAt: "2026-09-25T11:51:09.000Z" })
    );
    expect(mocks.loadL2BlockTime).toHaveBeenCalledTimes(2);
  });

  it("keeps tracking a withdrawal first seen finalized until its block's time is read", async () => {
    vi.useFakeTimers();

    try {
      mocks.loadWithdrawalStatus.mockResolvedValue({
        ...readyToProveStatus(),
        stage: "finalized",
      });
      mocks.loadL2BlockTime.mockRejectedValueOnce(new Error("RPC unavailable"));

      const tracking = trackWithdrawalTransaction(transactionHash);

      await vi.advanceTimersByTimeAsync(0);

      expect(getRememberedWithdrawalTransaction(transactionHash)).toEqual(
        expect.objectContaining({ sentAt: null, stage: "finalized" })
      );

      // Tracked still, and again after a reload.
      expect(
        resumeWithdrawalTracking(account).map((item) => item.transactionHash)
      ).toStrictEqual([transactionHash]);

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(tracking).resolves.toEqual(
        expect.objectContaining({
          sentAt: "2026-09-25T11:51:09.000Z",
          stage: "finalized",
        })
      );
      expect(mocks.loadWithdrawalStatus).toHaveBeenCalledOnce();
      expect(mocks.loadL2BlockTime).toHaveBeenCalledTimes(2);
      expect(resumeWithdrawalTracking(account)).toStrictEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists canonical withdrawal progress independently of the activity route", async () => {
    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      proofSubmitter: account,
      readyAt: 1_784_193_700n,
      readyAtExact: true,
      stage: "proven_waiting",
      statusMessage: "The proof is accepted.",
    });

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        blockNumber: "4421",
        proofSubmitter: account,
        readyAt: "1784193700",
        readyAtExact: true,
        stage: "proven_waiting",
        trackingError: null,
        withdrawalHash,
      })
    );
    expect(getRememberedWithdrawalTransaction(transactionHash)).toEqual(
      expect.objectContaining({
        stage: "proven_waiting",
        statusMessage: "The proof is accepted.",
      })
    );
  });

  it("keeps the proof's game and a late game's date, and reads that game with the Portal next time", async () => {
    const game = `0x${"1e".repeat(20)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      claimOverdue: true,
      disputeGameProxy: game,
      proofSubmitter: account,
      readyAt: 1_793_459_389n,
      readyAtExact: false,
      stage: "proven_waiting",
    });

    await refreshWithdrawalTransaction(transactionHash);

    expect(getRememberedWithdrawalTransaction(transactionHash)).toEqual(
      expect.objectContaining({
        claimOverdue: true,
        proofGame: game,
        readyAt: "1793459389",
      })
    );
    expect(mocks.loadWithdrawalStatus).toHaveBeenLastCalledWith(
      transactionHash,
      { proofGame: null }
    );

    // A game that couldn't be read leaves the date known so far.
    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      disputeGameProxy: game,
      proofSubmitter: account,
      stage: "proven_waiting",
    });

    await refreshWithdrawalTransaction(transactionHash);

    expect(mocks.loadWithdrawalStatus).toHaveBeenLastCalledWith(
      transactionHash,
      { proofGame: game }
    );
    expect(getRememberedWithdrawalTransaction(transactionHash)).toEqual(
      expect.objectContaining({ claimOverdue: true, readyAt: "1793459389" })
    );
  });

  it("remembers a rejected proof", async () => {
    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      proofRejected: true,
      proofSubmitter: account,
      readyAt: null,
      readyAtExact: false,
      stage: "proven_waiting",
    });

    await refreshWithdrawalTransaction(transactionHash);

    expect(getRememberedWithdrawalTransaction(transactionHash)).toEqual(
      expect.objectContaining({ proofRejected: true, stage: "proven_waiting" })
    );
  });

  it("keeps a submitted proof pending until Dusk execution is reflected", async () => {
    updateWithdrawalTransaction(transactionHash, {
      pendingAction: "prove",
      pendingTransactionHash: duskTransactionHash,
      stage: "prove_submitted",
    });
    mocks.loadWithdrawalStatus.mockResolvedValue(readyToProveStatus());
    mocks.loadDuskTransactionExecution.mockResolvedValue(null);

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        pendingAction: "prove",
        pendingTransactionHash: duskTransactionHash,
        stage: "prove_submitted",
      })
    );
  });

  it("restores the prove action when the Dusk proof transaction fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    updateWithdrawalTransaction(transactionHash, {
      pendingAction: "prove",
      pendingTransactionHash: duskTransactionHash,
      stage: "prove_submitted",
    });
    mocks.loadWithdrawalStatus.mockResolvedValue(readyToProveStatus());
    mocks.loadDuskTransactionExecution.mockResolvedValue({
      blockHeight: 4500n,
      error: "contract execution failed",
    });

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        actionError: "Proof transaction failed: contract execution failed",
        pendingAction: null,
        pendingTransactionHash: null,
        stage: "ready_to_prove",
      })
    );
    // The card shows a short line, so the raw error goes to the console.
    expect(consoleError).toHaveBeenCalledWith(
      "Proof transaction failed: contract execution failed"
    );

    consoleError.mockRestore();
  });

  it("clears the submitted proof once portal state reflects it", async () => {
    updateWithdrawalTransaction(transactionHash, {
      pendingAction: "prove",
      pendingTransactionHash: duskTransactionHash,
      stage: "prove_submitted",
    });
    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      proofSubmitter: account,
      stage: "proven_waiting",
    });

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        pendingAction: null,
        pendingTransactionHash: null,
        stage: "proven_waiting",
      })
    );
    expect(mocks.loadDuskTransactionExecution).not.toHaveBeenCalled();
  });

  it("treats an unmined L2 transaction as expected pending state", async () => {
    mocks.loadWithdrawalStatus.mockRejectedValue(
      new Error("Withdrawal transaction was not found.")
    );

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        stage: "submitted",
        trackingError: null,
      })
    );
  });

  it("records an L2 revert as a terminal withdrawal failure", async () => {
    mocks.loadWithdrawalStatus.mockRejectedValue(
      new Error("Withdrawal transaction failed on DuskEVM.")
    );

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        actionError: "Withdrawal transaction failed on DuskEVM.",
        stage: "failed",
        trackingError: null,
      })
    );
  });

  it("retains the last confirmed state during a transient tracking failure", async () => {
    updateWithdrawalTransaction(transactionHash, {
      stage: "waiting_for_output",
    });
    mocks.loadWithdrawalStatus.mockRejectedValue(new Error("RPC unavailable"));

    await expect(
      refreshWithdrawalTransaction(transactionHash)
    ).resolves.toEqual(
      expect.objectContaining({
        stage: "waiting_for_output",
        trackingError: "RPC unavailable",
      })
    );
  });
});
