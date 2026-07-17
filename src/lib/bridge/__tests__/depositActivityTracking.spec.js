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
const otherDuskTransactionHash = "55".repeat(32);
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
      .mockResolvedValueOnce({ tx: { blockHeight: 8512 } })
      .mockResolvedValueOnce({
        block: {
          status: { Final: 1 },
          transactions: [
            { id: otherDuskTransactionHash },
            { id: duskTransactionHash },
          ],
        },
      });
    mocks.request.mockResolvedValue({
      transactions: [
        { hash: `0x${"66".repeat(32)}` },
        { hash: l1TransactionHash },
      ],
    });
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
      `tx(hash: "${duskTransactionHash}") { blockHeight }`
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      "block(height: 8512) { status transactions { id } }"
    );
    expect(mocks.request).toHaveBeenCalledWith({
      method: "eth_getBlockByNumber",
      params: ["0x2140", true],
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
      .mockResolvedValueOnce({ tx: { blockHeight: 8512 } })
      .mockResolvedValueOnce({
        block: {
          status: { Attested: 1 },
          transactions: [{ id: duskTransactionHash }],
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
      .mockResolvedValueOnce({ tx: { blockHeight: 8512 } })
      .mockResolvedValueOnce({
        block: {
          status: { Final: 1 },
          transactions: [{ id: duskTransactionHash }],
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
});
