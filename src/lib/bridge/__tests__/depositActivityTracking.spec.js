import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicClient: vi.fn(() => ({ chain: { id: 310 } })),
  observeDepositStatus: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@dusk/evm-sdk", () => ({
  observeDepositStatus: mocks.observeDepositStatus,
}));

vi.mock("@wagmi/core", () => ({
  getPublicClient: mocks.getPublicClient,
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({ request: mocks.request })),
  http: vi.fn(() => ({})),
}));

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: { id: 310 },
  wagmiConfig: {},
}));

const duskTransactionHash = "44".repeat(32);
/** @type {`0x${string}`} */
const l1TransactionHash = `0x${"77".repeat(32)}`;
/** @type {`0x${string}`} */
const l2TransactionHash = `0x${"88".repeat(32)}`;

/** @type {typeof import("../depositActivity").refreshDepositTransaction} */
let refreshDepositTransaction;
/** @type {typeof import("../depositActivityStorage").getRememberedDepositTransaction} */
let getRememberedDepositTransaction;
/** @type {typeof import("../depositActivityStorage").rememberDepositTransaction} */
let rememberDepositTransaction;

describe("DuskEVM deposit tracking", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_EVM_L1_BRIDGE_RPC_URL", "https://l1.example.test");

    ({ refreshDepositTransaction } = await import("../depositActivity"));
    ({ getRememberedDepositTransaction, rememberDepositTransaction } =
      await import("../depositActivityStorage"));
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.getPublicClient.mockClear();
    mocks.observeDepositStatus.mockReset();
    mocks.request.mockReset();
  });

  it("resolves the native Dusk hash before observing the canonical deposit", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.request.mockResolvedValue(l1TransactionHash);
    mocks.observeDepositStatus.mockResolvedValue({
      message: "The deposit is available on DuskEVM.",
      metadata: {
        failureLayer: null,
        l1BlockHeight: 8512n,
        l2BlockNumber: 5n,
        l2TransactionHash,
        stage: "completed",
      },
      updatedAt: 1_784_193_700_000,
    });

    const result = await refreshDepositTransaction(duskTransactionHash);

    expect(mocks.request).toHaveBeenCalledWith({
      method: "duskevm_getTransactionHashByDuskHash",
      params: [duskTransactionHash],
    });
    expect(mocks.observeDepositStatus).toHaveBeenCalledWith(
      expect.objectContaining({ l1TransactionHash })
    );
    expect(result).toEqual(
      expect.objectContaining({
        l1TransactionHash,
        l2TransactionHash,
        stage: "completed",
        transactionHash: duskTransactionHash,
      })
    );
  });

  it("keeps an unindexed Dusk transaction pending without reporting an error", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.request.mockResolvedValue(null);

    const result = await refreshDepositTransaction(duskTransactionHash);

    expect(mocks.observeDepositStatus).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        l1TransactionHash: null,
        stage: "l1_pending",
        trackingError: null,
      })
    );
    expect(
      getRememberedDepositTransaction(duskTransactionHash)?.trackingError
    ).toBeNull();
  });
});
