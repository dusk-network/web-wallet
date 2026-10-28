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
  historyWithdrawals,
  hydrateWithdrawalActivity,
  loadWithdrawalActivity,
  mergeWithdrawalActivity,
  rememberHistoryWithdrawals,
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

    const items = await fetchWithdrawalActivity(account);

    expect(items).toEqual([
      expect.objectContaining({
        account,
        amountWei: "100000000000000000",
        blockNumber: "124",
        explorerStatus: "Ready to prove",
        source: "explorer",
        stage: "ready_to_prove",
        transactionHash: withdrawalHash,
      }),
    ]);
    // The explorer's challenge period end is no claim date: the chain says it.
    expect(items[0]).not.toHaveProperty("challengePeriodEnd");
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

  it("lists the latest sent first, by the DuskEVM block's time once known, not by when a withdrawal was looked up", () => {
    const sentFirst = `0x${"81".repeat(32)}`;
    const sentLast = `0x${"82".repeat(32)}`;

    // Looked up now, the first one sent in September.
    const lookedUp = {
      ...rememberWithdrawalTransaction(
        /** @type {`0x${string}`} */ (sentFirst),
        {
          account,
          createdAt: Date.parse("2026-10-26T01:10:00Z"),
        }
      ),
      sentAt: "2026-09-24T20:49:00.000Z",
    };
    const sentHere = rememberWithdrawalTransaction(
      /** @type {`0x${string}`} */ (sentLast),
      { account, createdAt: Date.parse("2026-10-01T09:00:00Z") }
    );

    expect(
      mergeWithdrawalActivity(
        [/** @type {any} */ (lookedUp), /** @type {any} */ (sentHere)],
        []
      ).map((item) => item.transactionHash)
    ).toEqual([sentLast, sentFirst]);
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
    const indexed =
      /** @type {Partial<NonNullable<ReturnType<typeof rememberWithdrawalTransaction>>>} */ ({
        ...remembered,
        source: "explorer",
        stage: "ready_to_prove",
        withdrawalHash: null,
      });
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

  describe("the withdrawals the history knows", () => {
    /** A withdrawal's nonce as its proof carries it: version 1, then its count. */
    const nonceOf = (/** @type {number} */ count) =>
      (1n << 240n) | BigInt(count);
    /** @param {number} count */
    const nonceHex = (count) => nonceOf(count).toString(16).padStart(64, "0");
    /** @param {number} count */
    const hashOf = (count) =>
      /** @type {`0x${string}`} */ (
        `0x${count.toString(16).padStart(64, "a")}`
      );
    /** @param {number} count */
    const txOf = (count) => `0x${count.toString(16).padStart(64, "7")}`;

    /**
     * A withdrawal in DuskEVM's explorer's list of all of them.
     *
     * @param {number} count
     */
    const listed = (count) => ({
      ["challenge_period_end"]: null,
      from: { hash: "0xC11d5aAb4234E255E214aC6e8c0ad61FA0836473" },
      ["l2_timestamp"]: "2026-10-01T12:50:11.000000Z",
      ["l2_transaction_hash"]: txOf(count),
      ["msg_nonce"]: count,
      ["msg_nonce_raw"]: nonceOf(count).toString(),
      ["msg_value"]: "1000000000000000000",
      status: "Proven",
    });

    it("are the ones the account proved or claimed, once each, by hash", () => {
      /**
       * @param {"claim" | "prove"} kind
       * @param {number} count
       * @param {Partial<ActivityRow>} [fields]
       */
      const row = (kind, count, fields = {}) =>
        /** @type {ActivityRow} */ ({
          bridge: {
            amount: "1000000000",
            hash: hashOf(count),
            kind,
            withdrawal: nonceHex(count),
          },
          status: "executed",
          ...fields,
        });

      expect(
        historyWithdrawals([
          row("claim", 40),
          row("prove", 41),
          row("prove", 40),
          // A failed proof proved nothing; one read before the history kept
          // its hash isn't known yet.
          row("prove", 39, { status: "failed" }),
          /** @type {ActivityRow} */ ({
            bridge: { amount: "1", kind: "prove", withdrawal: nonceHex(38) },
            status: "executed",
          }),
          /** @type {ActivityRow} */ ({ status: "executed" }),
        ])
      ).toStrictEqual([
        { hash: hashOf(40), nonce: nonceOf(40) },
        { hash: hashOf(41), nonce: nonceOf(41) },
      ]);
    });

    it("are found on DuskEVM's explorer by their nonces, however they were sent, and remembered for their sender", async () => {
      const fetchMock = vi.fn(async (/** @type {URL} */ url) => {
        const page = url.searchParams.get("nonce");

        return jsonResponse(
          page
            ? { items: [listed(40), listed(39)], ["next_page_params"]: null }
            : {
                items: [listed(43), listed(42), listed(41)],
                ["next_page_params"]: { nonce: 41 },
              }
        );
      });

      vi.stubGlobal("fetch", fetchMock);

      const found = await rememberHistoryWithdrawals([
        { hash: hashOf(41), nonce: nonceOf(41) },
        { hash: hashOf(40), nonce: nonceOf(40) },
      ]);

      expect(found.map((item) => item.transactionHash)).toStrictEqual([
        txOf(41),
        txOf(40),
      ]);
      expect(found[0]).toEqual(
        expect.objectContaining({
          account: "0xc11d5aab4234e255e214ac6e8c0ad61fa0836473",
          amountWei: "1000000000000000000",
          createdAt: Date.parse("2026-10-01T12:50:11Z"),
          withdrawalHash: hashOf(41),
        })
      );
      // The list of all withdrawals, newest first, only until the oldest asked for.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        `${mocks.explorerUrl}/api/v2/optimism/withdrawals`
      );
      expect(String(fetchMock.mock.calls[1][0])).toContain("nonce=41");
      expect(
        hydrateWithdrawalActivity().map((item) => item.withdrawalHash)
      ).toEqual(expect.arrayContaining([hashOf(41), hashOf(40)]));

      // Remembered: not asked for again.
      await expect(
        rememberHistoryWithdrawals([{ hash: hashOf(41), nonce: nonceOf(41) }])
      ).resolves.toStrictEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("aren't asked for again for a while when the explorer doesn't list them", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ items: [listed(43)], ["next_page_params"]: null })
      );

      vi.stubGlobal("fetch", fetchMock);

      const missing = [{ hash: hashOf(12), nonce: nonceOf(12) }];

      await expect(rememberHistoryWithdrawals(missing)).resolves.toStrictEqual(
        []
      );
      await expect(rememberHistoryWithdrawals(missing)).resolves.toStrictEqual(
        []
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
