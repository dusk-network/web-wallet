import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  getPublicClient: vi.fn(() => ({ chain: { id: 310 } })),
  observeDepositStatus: vi.fn(),
  query: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@dusk/evm-sdk", () => ({
  observeDepositStatus: mocks.observeDepositStatus,
}));

vi.mock("@wagmi/core", () => ({
  getPublicClient: mocks.getPublicClient,
}));

vi.mock("$lib/stores", () => ({
  networkStore: { connect: mocks.connect },
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
/** @type {typeof import("../depositActivity").depositTrackingPollInterval} */
let depositTrackingPollInterval;
/** @type {typeof import("../depositActivityStorage").getRememberedDepositTransaction} */
let getRememberedDepositTransaction;
/** @type {typeof import("../depositActivityStorage").rememberDepositTransaction} */
let rememberDepositTransaction;

describe("DuskEVM deposit tracking", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_EVM_L1_BRIDGE_RPC_URL", "https://l1.example.test");

    ({ depositTrackingPollInterval, refreshDepositTransaction } =
      await import("../depositActivity"));
    ({ getRememberedDepositTransaction, rememberDepositTransaction } =
      await import("../depositActivityStorage"));
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.connect.mockReset();
    mocks.connect.mockResolvedValue({ query: mocks.query });
    mocks.getPublicClient.mockClear();
    mocks.observeDepositStatus.mockReset();
    mocks.query.mockReset();
    mocks.request.mockReset();
  });

  it("resolves the native Dusk hash before observing the canonical deposit", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.query
      .mockResolvedValueOnce({ tx: { blockHeight: 8512, err: null } })
      .mockResolvedValueOnce({
        block: {
          status: { Final: 1 },
        },
      });
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

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      `tx(hash: "${duskTransactionHash}") { blockHeight err }`
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      "block(height: 8512) { status }"
    );
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

  it("keeps an unfinalized Dusk transaction pending without reporting an error", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.query
      .mockResolvedValueOnce({ tx: { blockHeight: 8512, err: null } })
      .mockResolvedValueOnce({
        block: {
          status: { Attested: 1 },
        },
      });

    const result = await refreshDepositTransaction(duskTransactionHash);

    expect(mocks.request).not.toHaveBeenCalled();
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

  it("keeps a finalized deposit pending while the adapter catches up", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.query
      .mockResolvedValueOnce({ tx: { blockHeight: 8512, err: null } })
      .mockResolvedValueOnce({
        block: {
          status: { Final: 1 },
        },
      });
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
  });

  it("marks an included Dusk execution error as a terminal L1 failure", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.query
      .mockResolvedValueOnce({
        tx: { blockHeight: 8512, err: "deposit rejected" },
      })
      .mockResolvedValueOnce({ block: { status: { Final: 1 } } });

    const result = await refreshDepositTransaction(duskTransactionHash);

    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        failureLayer: "l1",
        stage: "failed",
        statusMessage: "The DuskDS deposit failed: deposit rejected",
        trackingError: null,
      })
    );
  });

  it("keeps a non-final failed Dusk inclusion pending for reorg recovery", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.query
      .mockResolvedValueOnce({
        tx: { blockHeight: 8512, err: "deposit rejected" },
      })
      .mockResolvedValueOnce({ block: { status: { Attested: 1 } } });

    const result = await refreshDepositTransaction(duskTransactionHash);

    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        failureLayer: null,
        stage: "l1_pending",
        trackingError: null,
      })
    );
  });

  it("backs off unchanged tracking without exceeding five minutes", () => {
    expect(depositTrackingPollInterval(0, false)).toBe(5_000);
    expect(depositTrackingPollInterval(6, false)).toBe(10_000);
    expect(depositTrackingPollInterval(36, false)).toBe(300_000);
    expect(depositTrackingPollInterval(36, true)).toBe(300_000);
  });
});
