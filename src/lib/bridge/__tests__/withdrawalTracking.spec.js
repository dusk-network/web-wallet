import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDuskTransactionExecution: vi.fn(),
  loadWithdrawalStatus: vi.fn(),
}));

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: { id: 310 },
}));

vi.mock("$lib/bridge/withdrawals", () => ({
  loadDuskTransactionExecution: mocks.loadDuskTransactionExecution,
  loadWithdrawalStatus: mocks.loadWithdrawalStatus,
}));

const account = "0x2222222222222222222222222222222222222222";
const transactionHash = /** @type {`0x${string}`} */ (`0x${"44".repeat(32)}`);
const withdrawalHash = /** @type {`0x${string}`} */ (`0x${"55".repeat(32)}`);
const duskTransactionHash = "66".repeat(32);

/** @type {typeof import("../withdrawalTracking").refreshWithdrawalTransaction} */
let refreshWithdrawalTransaction;
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
    ({ refreshWithdrawalTransaction } = await import("../withdrawalTracking"));
    ({
      getRememberedWithdrawalTransaction,
      rememberWithdrawalTransaction,
      updateWithdrawalTransaction,
    } = await import("../withdrawalActivityStorage"));
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.loadDuskTransactionExecution.mockReset();
    mocks.loadWithdrawalStatus.mockReset();
    rememberWithdrawalTransaction(transactionHash, { account });
  });

  it("persists canonical withdrawal progress independently of the activity route", async () => {
    mocks.loadWithdrawalStatus.mockResolvedValue({
      ...readyToProveStatus(),
      proofSubmitter: account,
      readyAt: 1_784_193_700n,
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
