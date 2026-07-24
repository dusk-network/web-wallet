import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bridgeAddress: "0x1111111111111111111111111111111111111111",
  chainId: 5678,
  explorerUrl: "https://explorer.example.test",
}));

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: {
    blockExplorers: {
      default: {
        url: mocks.explorerUrl,
      },
    },
    contracts: {
      L2StandardBridge: {
        address: mocks.bridgeAddress,
      },
    },
    id: mocks.chainId,
  },
}));

import {
  explorerStatusToStage,
  fetchWithdrawalActivity,
  getRememberedWithdrawalActivity,
  loadWithdrawalActivity,
  mergeWithdrawalActivity,
  rememberWithdrawalTransaction,
  withdrawalStageProgress,
} from "$lib/bridge/withdrawalActivity";

const account = "0x2222222222222222222222222222222222222222";
const otherAccount = "0x3333333333333333333333333333333333333333";
const withdrawalHash = /** @type {`0x${string}`} */ (`0x${"44".repeat(32)}`);
const otherHash = /** @type {`0x${string}`} */ (`0x${"55".repeat(32)}`);

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function jsonResponse(body, status = 200) {
  return {
    json: vi.fn().mockResolvedValue(body),
    ok: status >= 200 && status < 300,
    status,
  };
}

describe("DuskEVM withdrawal activity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["Waiting for state root", "waiting_for_output"],
    ["Ready to prove", "ready_to_prove"],
    ["In challenge period", "proven_waiting"],
    ["Ready for relay", "ready_to_finalize"],
    ["Relayed", "finalized"],
    [undefined, "submitted"],
  ])("maps explorer status %s to %s", (status, stage) => {
    expect(explorerStatusToStage(status)).toBe(stage);
  });

  it("maps lifecycle stages to the five-step timeline", () => {
    expect(withdrawalStageProgress("submitted")).toBe(0);
    expect(withdrawalStageProgress("waiting_for_output")).toBe(1);
    expect(withdrawalStageProgress("ready_to_prove")).toBe(2);
    expect(withdrawalStageProgress("proven_waiting")).toBe(3);
    expect(withdrawalStageProgress("ready_to_finalize")).toBe(4);
    expect(withdrawalStageProgress("finalized")).toBe(5);
  });

  it("keeps remembered withdrawals scoped to their EVM account", () => {
    rememberWithdrawalTransaction(withdrawalHash, {
      account,
      createdAt: 1_000,
    });
    rememberWithdrawalTransaction(otherHash, {
      account: otherAccount,
      createdAt: 2_000,
    });

    expect(
      getRememberedWithdrawalActivity(account).map(
        (item) => item.transactionHash
      )
    ).toEqual([withdrawalHash]);
    expect(
      getRememberedWithdrawalActivity(otherAccount).map(
        (item) => item.transactionHash
      )
    ).toEqual([otherHash]);
  });

  it("preserves the initial timestamp when pending activity is refreshed", () => {
    rememberWithdrawalTransaction(withdrawalHash, {
      account,
      amountWei: 2_500_000_000_000_000_000n,
      createdAt: 2_000,
    });
    rememberWithdrawalTransaction(withdrawalHash, { account });

    expect(getRememberedWithdrawalActivity(account)).toEqual([
      expect.objectContaining({
        amountWei: "2500000000000000000",
        createdAt: 2_000,
        timestamp: new Date(2_000).toISOString(),
      }),
    ]);
  });

  it("discovers bridge calls and enriches them with Blockscout OP status", async () => {
    const unrelatedHash = `0x${"66".repeat(32)}`;
    const directTransferHash = `0x${"77".repeat(32)}`;
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);

      if (url.includes(`/transactions/${withdrawalHash}`)) {
        return jsonResponse({
          ["block_number"]: 124,
          from: { hash: account },
          hash: withdrawalHash,
          ["op_withdrawals"]: [
            {
              ["challenge_period_end"]: "2026-07-15T10:00:00Z",
              ["l1_transaction_hash"]: null,
              ["l2_timestamp"]: "2026-07-14T10:00:00Z",
              ["msg_value"]: "100000000000000000",
              status: "Ready to prove",
            },
          ],
          status: "ok",
          timestamp: "2026-07-14T10:00:00Z",
          to: { hash: mocks.bridgeAddress },
          value: "100000000000000000",
        });
      }

      return jsonResponse({
        items: [
          {
            from: { hash: account },
            hash: withdrawalHash,
            ["raw_input"]: `0xe11013dd${"00".repeat(96)}`,
            status: "ok",
            timestamp: "2026-07-14T10:00:00Z",
            to: { hash: mocks.bridgeAddress },
            value: "100000000000000000",
          },
          {
            from: { hash: account },
            hash: directTransferHash,
            ["raw_input"]: "0x",
            status: "ok",
            to: { hash: mocks.bridgeAddress },
            value: "100000000000000000",
          },
          {
            from: { hash: account },
            hash: unrelatedHash,
            status: "ok",
            to: { hash: otherAccount },
          },
        ],
        ["next_page_params"]: null,
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithdrawalActivity(account)).resolves.toEqual([
      expect.objectContaining({
        account,
        amountWei: "100000000000000000",
        blockNumber: "124",
        challengePeriodEnd: "2026-07-15T10:00:00.000Z",
        explorerStatus: "Ready to prove",
        source: "explorer",
        stage: "ready_to_prove",
        transactionHash: withdrawalHash,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("filter=from");
  });

  it("falls back to remembered activity when Blockscout is unavailable", async () => {
    rememberWithdrawalTransaction(withdrawalHash, {
      account,
      createdAt: 1_000,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(loadWithdrawalActivity(account)).resolves.toEqual({
      error: "offline",
      items: [
        expect.objectContaining({
          source: "local",
          stage: "submitted",
          transactionHash: withdrawalHash,
        }),
      ],
      sourceUnavailable: true,
    });
  });

  it("lets indexed status replace the local pending overlay", () => {
    const remembered = rememberWithdrawalTransaction(withdrawalHash, {
      account,
      createdAt: 1_000,
    });
    const indexed = {
      ...remembered,
      createdAt: 2_000,
      source: "explorer",
      stage: "finalized",
    };

    expect(
      mergeWithdrawalActivity(
        [/** @type {any} */ (remembered)],
        [/** @type {any} */ (indexed)]
      )
    ).toEqual([
      expect.objectContaining({
        createdAt: 1_000,
        source: "explorer",
        stage: "finalized",
      }),
    ]);
  });

  it("keeps indexed progress when tracking fails before canonical observation", () => {
    const remembered = {
      ...rememberWithdrawalTransaction(withdrawalHash, {
        account,
        createdAt: 1_000,
      }),
      lastCheckedAt: 2_000,
      trackingError: "RPC unavailable",
    };
    const indexed = {
      ...remembered,
      source: "explorer",
      stage: "ready_to_prove",
      withdrawalHash: null,
    };
    delete indexed.lastCheckedAt;
    delete indexed.trackingError;

    expect(
      mergeWithdrawalActivity(
        [/** @type {any} */ (remembered)],
        [/** @type {any} */ (indexed)]
      )
    ).toEqual([
      expect.objectContaining({
        stage: "ready_to_prove",
        trackingError: "RPC unavailable",
      }),
    ]);
  });
});
