import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ETH_BRIDGE_FINALIZED_TOPIC } from "@dusk-network/app-core/bridge";
import { networks } from "@dusk-network/networks";
import { evmAddressOf } from "@dusk-network/networks/duskevm";

import { rowOf, rowsOf } from "$lib/activity/__tests__/fixtures/rows";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { fakeChain, topicOf, wordOf } from "./fixtures/chain";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createPublicClient: vi.fn(),
  getBlock: vi.fn(),
  http: vi.fn(),
  /** DuskEVM's L2 bridge, as the wallet has it: the network's, or one set for local work. */
  l2Bridge: "0x4200000000000000000000000000000000000010",
  observeDepositStatus: vi.fn(),
  query: vi.fn(),
  request: vi.fn(),
  /** The history of the account shown. @type {any[]} */
  rows: [],
  /** The deposits the archive lists in the account's history, as it gives them. @type {any[]} */
  sent: [],
}));

const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

// The history of ACCOUNT, shown, and its archive, where it sent nothing but
// the deposits a test lists.
vi.mock("$lib/activity", () => ({
  activityState: {
    /** @param {(state: { rows: any[] }) => void} run */
    subscribe(run) {
      run({ rows: mocks.rows });

      return () => {};
    },
  },
  currentActivity: () => ({ options: { account: ACCOUNT } }),
}));

vi.mock("$lib/activity/activityHistory", () => ({
  archiveAt: () => ({
    /** @param {string} query */
    query: async (query) => {
      const range = /fromBlock: (\d+)(?:, toBlock: (\d+))?/.exec(query);
      // One page holds them all.
      const json =
        range && !query.includes("pageCount")
          ? mocks.sent.filter(
              (entry) =>
                entry.block_height >= Number(range[1]) &&
                entry.block_height <= Number(range[2] ?? Infinity)
            )
          : [];

      return { out: json.length ? { json } : null };
    },
  }),
}));

vi.mock("@dusk/evm-sdk", () => ({
  observeDepositStatus: mocks.observeDepositStatus,
}));

vi.mock("$lib/stores", () => ({
  networkStore: { connect: mocks.connect },
}));

vi.mock("viem", () => ({
  createPublicClient: mocks.createPublicClient,
  http: mocks.http,
}));

// DuskEVM on the node's network, with its adapter at /l1 on its RPC's
// host, and no EVM wallet connection started: a deposit is followed
// without one.
vi.mock("$lib/web3/duskEvm", () => ({
  duskEvm: {
    get contracts() {
      return { L2StandardBridge: { address: mocks.l2Bridge } };
    },
    id: 310,
    rpcUrls: { default: { http: ["https://l2.example.test"] } },
  },
  duskEvmAdapterUrl: () => "https://l2.example.test/l1",
  duskEvmContractId: () => "",
}));

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: { id: 310 },
  wagmiConfig: undefined,
}));

const duskTransactionHash = "44".repeat(32);
/** @type {`0x${string}`} */
const l1TransactionHash = `0x${"77".repeat(32)}`;
/** @type {`0x${string}`} */
const l2TransactionHash = `0x${"88".repeat(32)}`;

/** @type {typeof import("../depositActivity").refreshDepositTransaction} */
let refreshDepositTransaction;
/** @type {typeof import("../depositActivity").followHistoryDeposits} */
let followHistoryDeposits;
/** @type {typeof import("../depositActivity").depositTrackingPollInterval} */
let depositTrackingPollInterval;
/** @type {typeof import("../depositActivity").resumeDepositTracking} */
let resumeDepositTracking;
/** @type {typeof import("../depositActivityStorage").hydrateDepositActivity} */
let hydrateDepositActivity;
/** @type {typeof import("../depositActivityStorage").getRememberedDepositTransaction} */
let getRememberedDepositTransaction;
/** @type {typeof import("../depositActivityStorage").rememberDepositTransaction} */
let rememberDepositTransaction;
/** @type {typeof import("../depositActivityStorage").updateDepositTransaction} */
let updateDepositTransaction;

describe("DuskEVM deposit tracking", () => {
  beforeAll(async () => {
    ({
      depositTrackingPollInterval,
      followHistoryDeposits,
      refreshDepositTransaction,
      resumeDepositTracking,
    } = await import("../depositActivity"));
    ({
      getRememberedDepositTransaction,
      hydrateDepositActivity,
      rememberDepositTransaction,
      updateDepositTransaction,
    } = await import("../depositActivityStorage"));
  });

  beforeEach(() => {
    localStorage.clear();
    setNodeNetwork(networks.testnet);
    mocks.rows = [];
    mocks.sent = [];
    mocks.l2Bridge = "0x4200000000000000000000000000000000000010";
    mocks.connect.mockReset();
    mocks.connect.mockResolvedValue({ query: mocks.query });
    mocks.createPublicClient.mockImplementation(({ transport }) => ({
      getBlock: mocks.getBlock,
      request: mocks.request,
      transport,
    }));
    mocks.getBlock.mockReset();
    mocks.getBlock.mockResolvedValue({ timestamp: 1_784_193_690n });
    mocks.http.mockImplementation((url) => ({ url }));
    mocks.observeDepositStatus.mockReset();
    mocks.query.mockReset();
    mocks.request.mockReset();
  });

  afterEach(() => {
    setNodeNetwork(null);
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
      `tx(hash: "${duskTransactionHash}") { blockHeight blockTimestamp err }`
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
        // When it arrived: its DuskEVM block's time.
        arrivedAt: 1_784_193_690_000,
        l1TransactionHash,
        l2TransactionHash,
        stage: "completed",
        transactionHash: duskTransactionHash,
      })
    );
    expect(mocks.getBlock).toHaveBeenCalledExactlyOnceWith({
      blockNumber: 5n,
    });

    // DuskEVM's side is read from its own RPC, with no EVM wallet connected.
    expect(mocks.observeDepositStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        l2Client: expect.objectContaining({
          transport: { url: "https://l2.example.test" },
        }),
      })
    );
  });

  it("reads when a deposit arrived again where its DuskEVM block couldn't be read, and only that, once it's done", async () => {
    rememberDepositTransaction(duskTransactionHash);
    mocks.query
      .mockResolvedValueOnce({ tx: { blockHeight: 8512, err: null } })
      .mockResolvedValueOnce({ block: { status: { Final: 1 } } });
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
    mocks.getBlock.mockRejectedValueOnce(new Error("Too many requests"));

    expect(await refreshDepositTransaction(duskTransactionHash)).toEqual(
      expect.objectContaining({ arrivedAt: null, stage: "completed" })
    );

    // Done, it's read no more, but for its block's time.
    expect(await refreshDepositTransaction(duskTransactionHash)).toEqual(
      expect.objectContaining({
        arrivedAt: 1_784_193_690_000,
        stage: "completed",
      })
    );
    expect(mocks.observeDepositStatus).toHaveBeenCalledOnce();
    expect(mocks.getBlock).toHaveBeenCalledTimes(2);

    // Once it has it, nothing more.
    await refreshDepositTransaction(duskTransactionHash);

    expect(mocks.getBlock).toHaveBeenCalledTimes(2);

    // Following the wallet's deposits again reads it too.
    updateDepositTransaction(duskTransactionHash, { arrivedAt: null });
    resumeDepositTracking(null);

    await vi.waitFor(() =>
      expect(
        getRememberedDepositTransaction(duskTransactionHash)?.arrivedAt
      ).toBe(1_784_193_690_000)
    );
    expect(mocks.getBlock).toHaveBeenCalledTimes(3);
  });

  it("keeps the newest deposits, one on its way among them, when a history brings more than are kept", () => {
    const sending = "e1".repeat(32);
    const at = Date.parse("2026-10-26T04:49:20Z");
    /** The history's deposits, newest first: all before the one on its way. */
    const rows = rowsOf(
      Array.from({ length: 120 }, (_, i) => ({
        bridge: {
          amount: "100000000",
          kind: "deposit",
          to: "0xB0E834d62CA3f5cF0F82619c8515c673818f8C6b",
        },
        hash: (i + 1).toString(16).padStart(64, "0"),
        // Failed on Dusk: none of them is followed.
        status: "failed",
        timestamp: at - i * 60_000,
      }))
    );

    rememberDepositTransaction(sending, { createdAt: at + 60_000 });
    followHistoryDeposits(rows);

    const kept = hydrateDepositActivity().map((item) => item.transactionHash);

    expect(kept).toHaveLength(100);
    expect(kept[0]).toBe(sending);
    expect(kept.slice(1)).toStrictEqual(
      rows.slice(0, 99).map((row) => row.hash)
    );
  });

  /**
   * A deposit of 0.1 DUSK by ACCOUNT at block 8512, as the archive lists it
   * in ACCOUNT's history.
   *
   * @param {string} hash
   */
  const listed = (hash) => ({
    ["block_height"]: 8512,
    events: [
      {
        data: {
          receiver:
            networks.testnet.duskEvm?.contracts.l1_standard_bridge.contractId,
          sender: ACCOUNT,
          value: "100000000",
        },
        reverted: false,
        target: networks.testnet.contracts.transfer,
        topic: "deposit",
      },
    ],
    origin: hash,
  });

  it("finds the deposit arrived on DuskEVM when the adapter doesn't have the method, as on public testnet: at once, by its sender's DuskEVM address, once the history says who sent it", async () => {
    const recipient = "0xb0e834d62ca3f5cf0f82619c8515c673818f8c6b";
    const payment = `0x${"43".repeat(32)}`;
    const at = Date.parse("2026-10-26T04:49:20Z");
    // DuskEVM, a block a second: the bridge paid ACCOUNT's deposit 55
    // seconds after its Dusk block; a minute after it, now.
    const chain = fakeChain({
      blockMs: 1_000,
      head: 3_000_000n,
      headAt: at + 60_000,
      logs: [
        {
          address: networks.testnet.duskEvm?.predeploys.l2StandardBridge ?? "",
          block: 2_999_995n,
          data: `0x${wordOf(100_000_000n * 1_000_000_000n)}${wordOf(0x40n)}${wordOf(0n)}`,
          hash: payment,
          topics: [
            ETH_BRIDGE_FINALIZED_TOPIC,
            topicOf(evmAddressOf(ACCOUNT)),
            topicOf(recipient),
          ],
        },
      ],
      url: "https://l2.example.test",
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(chain.answer);

    mocks.sent = [listed(duskTransactionHash)];
    vi.useFakeTimers({ now: at + 60_000, toFake: ["Date"] });

    try {
      // Sent by a browser whose clock is ten minutes ahead.
      rememberDepositTransaction(duskTransactionHash, {
        account: recipient,
        amountLux: "100000000",
        createdAt: at + 600_000,
      });
      mocks.query.mockImplementation(async (/** @type {string} */ query) =>
        query.startsWith("tx(")
          ? { tx: { blockHeight: 8512, blockTimestamp: at / 1000, err: null } }
          : { block: { status: { Final: 1 } } }
      );
      mocks.request.mockRejectedValue(new Error("Method not found"));

      // Who sent it isn't known yet: another's deposit to the same address
      // could be paid in its first two minutes, so nothing is asked yet.
      await refreshDepositTransaction(duskTransactionHash);

      expect(
        getRememberedDepositTransaction(duskTransactionHash)
      ).toStrictEqual(
        expect.objectContaining({
          // Timed by its Dusk block, as the node gave it.
          l1BlockTimestamp: at,
          stage: "l1_pending",
        })
      );
      expect(chain.methods()).toStrictEqual([]);

      // The history has it now: sent by ACCOUNT, at its block.
      mocks.rows = rowsOf([
        {
          blockHeight: 8512,
          bridge: { amount: "100000000", kind: "deposit", to: recipient },
          hash: duskTransactionHash,
          status: "executed",
          timestamp: at,
        },
      ]);

      const result = await refreshDepositTransaction(duskTransactionHash);

      // The adapter first, then DuskEVM's RPC.
      expect(mocks.request).toHaveBeenCalledTimes(2);
      expect(chain.methods()).toContain("eth_getLogs");
      expect(result).toStrictEqual(
        expect.objectContaining({
          // When it arrived: its payment's block's time on DuskEVM.
          arrivedAt: at + 55_000,
          l2BlockNumber: "2999995",
          l2TransactionHash: payment,
          stage: "completed",
          trackingError: null,
        })
      );
    } finally {
      vi.useRealTimers();
      fetch.mockRestore();
    }
  });

  /** The DuskEVMs the tests made: each has blocks of its own, as the wallet keeps their times. */
  let chains = 0;

  /**
   * A deposit of 0.1 DUSK by ACCOUNT, sent at `at`, as the history shown and
   * this browser have it, which DuskEVM's adapter can't follow; and DuskEVM,
   * its newest block made now, a block every `blockMs`, where `bridge` paid
   * it 55 seconds after its Dusk block.
   *
   * @param {string} hash
   * @param {{ at: number, blockMs?: number, bridge: string }} deposit
   */
  function paidDeposit(hash, { at, blockMs = 1_000, bridge }) {
    const recipient = "0xb0e834d62ca3f5cf0f82619c8515c673818f8c6b";
    const now = Date.now();
    const head = 10_000_000n * BigInt((chains += 1));

    mocks.rows = rowsOf([
      {
        blockHeight: 8512,
        bridge: { amount: "100000000", kind: "deposit", to: recipient },
        hash,
        status: "executed",
        timestamp: at,
      },
    ]);
    mocks.sent = [listed(hash)];
    rememberDepositTransaction(hash, {
      account: recipient,
      amountLux: "100000000",
      createdAt: at,
    });
    mocks.query.mockImplementation(async (/** @type {string} */ query) =>
      query.startsWith("tx(")
        ? { tx: { blockHeight: 8512, blockTimestamp: at / 1000, err: null } }
        : { block: { status: { Final: 1 } } }
    );
    mocks.request.mockRejectedValue(new Error("Method not found"));

    return fakeChain({
      blockMs,
      head,
      headAt: now,
      logs: [
        {
          address: bridge,
          block: head - BigInt(Math.floor((now - at - 55_000) / blockMs)),
          data: `0x${wordOf(100_000_000n * 1_000_000_000n)}${wordOf(0x40n)}${wordOf(0n)}`,
          hash: l2TransactionHash,
          topics: [
            ETH_BRIDGE_FINALIZED_TOPIC,
            topicOf(evmAddressOf(ACCOUNT)),
            topicOf(recipient),
          ],
        },
      ],
      url: "https://l2.example.test",
    });
  }

  it("finds a deposit sent more than a week ago arrived on DuskEVM, in a browser that sees it only now", async () => {
    const hash = "91".repeat(32);
    // A DuskEVM block every 100 seconds: one look reaches back that far.
    const chain = paidDeposit(hash, {
      at: Date.now() - 8 * 86_400_000,
      blockMs: 100_000,
      bridge: mocks.l2Bridge,
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(chain.answer);

    try {
      expect(await refreshDepositTransaction(hash)).toStrictEqual(
        expect.objectContaining({ l2TransactionHash, stage: "completed" })
      );
    } finally {
      fetch.mockRestore();
    }
  });

  it("looks for a deposit's payment from DuskEVM's L2 bridge as set for local work", async () => {
    const hash = "92".repeat(32);

    mocks.l2Bridge = `0x${"99".repeat(20)}`;

    const chain = paidDeposit(hash, {
      at: Date.now() - 60_000,
      bridge: mocks.l2Bridge,
    });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(chain.answer);

    try {
      expect(await refreshDepositTransaction(hash)).toStrictEqual(
        expect.objectContaining({ l2TransactionHash, stage: "completed" })
      );
      expect(
        chain.asked
          .filter(({ method }) => method === "eth_getLogs")
          .map(({ params }) => params[0].address)
      ).toStrictEqual([mocks.l2Bridge]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("follows the history's deposits as the ones sent from here: kept for the DuskEVM address each pays, timed by its block", async () => {
    const final = "51".repeat(32);
    const failed = "52".repeat(32);
    const kept = "53".repeat(32);
    const at = Date.parse("2026-10-26T04:49:20Z");
    /** @type {(hash: string, fields?: Record<string, unknown>) => ActivityRow} */
    const deposit = (hash, fields = {}) =>
      rowOf({
        blockHeight: 4_700_000,
        bridge: {
          amount: "100000000",
          kind: "deposit",
          to: "0xB0E834d62CA3f5cF0F82619c8515c673818f8C6b",
        },
        hash,
        status: "executed",
        timestamp: at,
        ...fields,
      });

    // One already kept, arrived: left as it is.
    rememberDepositTransaction(kept, { account: `0x${"99".repeat(20)}` });
    updateDepositTransaction(kept, { stage: "completed" });
    // On Dusk, the deposit followed failed after all: it's followed no more.
    mocks.query.mockImplementation(async (/** @type {string} */ query) =>
      query.startsWith("tx(")
        ? {
            tx: {
              blockHeight: 4_700_000,
              blockTimestamp: at / 1000,
              err: "Panic",
            },
          }
        : { block: { status: { Final: 1 } } }
    );

    const followed = followHistoryDeposits([
      deposit(final),
      deposit(failed, { status: "failed" }),
      deposit(kept),
      rowOf({ hash: "54".repeat(32), status: "executed" }),
    ]);

    expect(followed).toStrictEqual(new Set([final, failed, kept]));
    expect(getRememberedDepositTransaction(final)).toEqual(
      expect.objectContaining({
        account: "0xb0e834d62ca3f5cf0f82619c8515c673818f8c6b",
        amountLux: "100000000",
        createdAt: at,
        l1BlockHeight: "4700000",
        l1BlockTimestamp: at,
      })
    );
    // One that failed on Dusk never left: nothing to follow.
    expect(getRememberedDepositTransaction(failed)).toEqual(
      expect.objectContaining({ failureLayer: "l1", stage: "failed" })
    );
    expect(getRememberedDepositTransaction(kept)?.account).toBe(
      `0x${"99".repeat(20)}`
    );

    // Followed on DuskEVM: as a deposit sent from here is.
    await vi.waitFor(() =>
      expect(mocks.query).toHaveBeenCalledWith(
        `tx(hash: "${final}") { blockHeight blockTimestamp err }`
      )
    );
    await vi.waitFor(() =>
      expect(getRememberedDepositTransaction(final)?.stage).toBe("failed")
    );
    expect(mocks.query).not.toHaveBeenCalledWith(
      `tx(hash: "${failed}") { blockHeight blockTimestamp err }`
    );
  });

  it("doesn't look on DuskEVM for a deposit before its Dusk block is final", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ items: [] }))
      );

    try {
      rememberDepositTransaction(duskTransactionHash, {
        account: "0xb0e834d62ca3f5cf0f82619c8515c673818f8c6b",
        amountLux: "100000000",
      });
      mocks.query
        .mockResolvedValueOnce({
          tx: { blockHeight: 8512, blockTimestamp: 1_793_000_000, err: null },
        })
        .mockResolvedValueOnce({ block: { status: { Attested: 1 } } });

      const result = await refreshDepositTransaction(duskTransactionHash);

      expect(result).toEqual(
        expect.objectContaining({ l1BlockTimestamp: null, stage: "l1_pending" })
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("doesn't look on DuskEVM for a deposit that failed on Dusk", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    try {
      rememberDepositTransaction(duskTransactionHash, {
        account: "0xb0e834d62ca3f5cf0f82619c8515c673818f8c6b",
        amountLux: "100000000",
      });
      mocks.query
        .mockResolvedValueOnce({ tx: { blockHeight: 8512, err: "Panic" } })
        .mockResolvedValueOnce({ block: { status: { Final: 1 } } });

      const result = await refreshDepositTransaction(duskTransactionHash);

      expect(result).toEqual(expect.objectContaining({ stage: "failed" }));
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
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
