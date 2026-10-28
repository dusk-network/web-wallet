import { afterEach, describe, expect, it, vi } from "vitest";

import { findDepositArrival } from "../depositArrival";

vi.mock("$lib/web3/duskEvm", () => ({
  duskEvm: {
    contracts: {
      L2StandardBridge: {
        address: "0x4200000000000000000000000000000000000010",
      },
    },
  },
  duskEvmBlockscoutApiUrl: () => "https://explorer.example.test/api/v2",
}));

const BRIDGE = "0x4200000000000000000000000000000000000010";
const TO = "0xab84edffd745af9420ac74fec73121fbee9fc86f";
const AT = Date.parse("2026-10-27T05:50:00Z");

/**
 * A deposit this browser keeps, on its way.
 *
 * @param {string} hash
 * @param {string} amountLux
 * @param {number} createdAt
 * @param {Record<string, unknown>} [fields]
 * @returns {any}
 */
const kept = (hash, amountLux, createdAt, fields = {}) => ({
  account: TO,
  amountLux,
  createdAt,
  l2TransactionHash: null,
  stage: "l1_pending",
  transactionHash: hash,
  ...fields,
});

/**
 * A call to the recipient on DuskEVM, as its explorer lists it.
 *
 * @param {string} hash
 * @param {string} value In wei
 * @param {string} timestamp
 * @param {Record<string, unknown>} [fields]
 */
const call = (hash, value, timestamp, fields = {}) => ({
  ["block_number"]: 1,
  from: { hash: BRIDGE },
  success: true,
  timestamp,
  ["transaction_hash"]: hash,
  value,
  ...fields,
});

/** @param {unknown[]} items */
const explorer = (items) =>
  vi.fn(async () => new Response(JSON.stringify({ items })));

describe("a deposit's arrival, from DuskEVM's explorer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the L2 bridge's first payment of its amount to its recipient after it, one payment for each deposit, oldest first", async () => {
    const first = kept("a1".repeat(32), "500000000", AT);
    const second = kept("a2".repeat(32), "500000000", AT + 60_000);
    const fetch = explorer([
      // Before both: another deposit's.
      call(
        `0x${"10".repeat(32)}`,
        "500000000000000000",
        "2026-10-27T05:40:00Z"
      ),
      // From someone else, and a failed call: not the bridge's payment.
      call(
        `0x${"11".repeat(32)}`,
        "500000000000000000",
        "2026-10-27T05:51:00Z",
        {
          from: { hash: `0x${"99".repeat(20)}` },
        }
      ),
      call(
        `0x${"12".repeat(32)}`,
        "500000000000000000",
        "2026-10-27T05:51:30Z",
        {
          success: false,
        }
      ),
      call(
        `0x${"13".repeat(32)}`,
        "500000000000000000",
        "2026-10-27T05:52:13.000000Z"
      ),
      call(
        `0x${"14".repeat(32)}`,
        "500000000000000000",
        "2026-10-27T05:53:13Z"
      ),
    ]);

    await expect(
      findDepositArrival(second, [first, second], { fetch })
    ).resolves.toStrictEqual({
      blockNumber: "1",
      hash: `0x${"14".repeat(32)}`,
    });
    await expect(
      findDepositArrival(first, [first, second], { fetch })
    ).resolves.toStrictEqual({
      blockNumber: "1",
      hash: `0x${"13".repeat(32)}`,
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://explorer.example.test/api/v2/addresses/${TO}/internal-transactions?filter=to`,
      expect.anything()
    );
  });

  it("isn't there without a payment of its amount after it that no other deposit has", async () => {
    const deposit = kept("a1".repeat(32), "500000000", AT);
    const paid = kept("a0".repeat(32), "500000000", AT - 600_000, {
      l2TransactionHash: `0x${"13".repeat(32)}`,
      stage: "completed",
    });

    await expect(
      findDepositArrival(deposit, [paid, deposit], {
        fetch: explorer([
          call(
            `0x${"13".repeat(32)}`,
            "500000000000000000",
            "2026-10-27T05:52:13Z"
          ),
          call(
            `0x${"14".repeat(32)}`,
            "400000000000000000",
            "2026-10-27T05:53:13Z"
          ),
        ]),
      })
    ).resolves.toBeNull();
  });
});
