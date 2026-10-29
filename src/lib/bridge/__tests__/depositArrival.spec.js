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
 * A deposit this browser keeps, on its way, in a block final at `at`, which
 * the browser's clock also saw.
 *
 * @param {string} hash
 * @param {string} amountLux
 * @param {number} at
 * @param {Record<string, unknown>} [fields]
 * @returns {any}
 */
const kept = (hash, amountLux, at, fields = {}) => ({
  account: TO,
  amountLux,
  createdAt: at,
  l1BlockTimestamp: at,
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

/**
 * An explorer whose calls come a page at a time, newest first, each but
 * the last saying where the next starts.
 *
 * @param {unknown[][]} pages
 * @param {{ more?: boolean }} [options] Whether the last page says there are more too
 */
const explorerPages = (pages, { more = false } = {}) =>
  vi.fn(async (/** @type {RequestInfo | URL} */ url) => {
    const page = Number(new URL(String(url)).searchParams.get("index") ?? 0);

    return new Response(
      JSON.stringify({
        items: pages[page],
        ["next_page_params"]:
          page < pages.length - 1 || more
            ? {
                ["block_number"]: 99 - page,
                filter: "to",
                index: page + 1,
                ["items_count"]: 50,
              }
            : null,
      })
    );
  });

/** What a deposit of 500000000 lux pays on DuskEVM, in wei. */
const PAID = "500000000000000000";

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
      // When it arrived: the payment's time on DuskEVM.
      at: Date.parse("2026-10-27T05:53:13Z"),
      blockNumber: "1",
      hash: `0x${"14".repeat(32)}`,
    });
    await expect(
      findDepositArrival(first, [first, second], { fetch })
    ).resolves.toStrictEqual({
      at: Date.parse("2026-10-27T05:52:13Z"),
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

  it("reads its recipient's calls a page at a time, back past its oldest deposit on its way, which then takes its own payment", async () => {
    const first = kept("a1".repeat(32), "500000000", AT);
    const second = kept("a2".repeat(32), "500000000", AT + 600_000);
    const fetch = explorerPages(
      [
        [
          call(`0x${"22".repeat(32)}`, PAID, "2026-10-27T06:01:00Z"),
          call(`0x${"30".repeat(32)}`, "7", "2026-10-27T05:59:00Z"),
        ],
        [
          call(`0x${"21".repeat(32)}`, PAID, "2026-10-27T05:51:00Z"),
          // Before the oldest deposit: no page further back is read.
          call(`0x${"20".repeat(32)}`, PAID, "2026-10-27T05:40:00Z"),
        ],
        [call(`0x${"19".repeat(32)}`, PAID, "2026-10-27T05:30:00Z")],
      ],
      { more: true }
    );

    await expect(
      findDepositArrival(first, [first, second], { fetch })
    ).resolves.toStrictEqual({
      at: expect.any(Number),
      blockNumber: "1",
      hash: `0x${"21".repeat(32)}`,
    });
    await expect(
      findDepositArrival(second, [first, second], { fetch })
    ).resolves.toStrictEqual({
      at: expect.any(Number),
      blockNumber: "1",
      hash: `0x${"22".repeat(32)}`,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toStrictEqual(
      Array(2)
        .fill([
          `https://explorer.example.test/api/v2/addresses/${TO}/internal-transactions?filter=to`,
          `https://explorer.example.test/api/v2/addresses/${TO}/internal-transactions?filter=to&block_number=99&index=1&items_count=50`,
        ])
        .flat()
    );
  });

  it("isn't found when its recipient's calls go back further than five pages", async () => {
    const deposit = kept("a1".repeat(32), "500000000", AT);
    const fetch = explorerPages(
      ["06:05", "06:04", "06:03", "06:02", "06:01"].map((time, page) => [
        call(
          `0x${String(page + 1).repeat(64)}`,
          PAID,
          `2026-10-27T${time}:00Z`
        ),
      ]),
      { more: true }
    );

    await expect(
      findDepositArrival(deposit, [deposit], { fetch })
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("is timed by its Dusk block, never by the browser's clock", async () => {
    // The browser's clock ten minutes ahead, then half an hour behind.
    const ahead = kept("a1".repeat(32), "500000000", AT, {
      createdAt: AT + 600_000,
    });
    const behind = kept("a2".repeat(32), "400000000", AT, {
      createdAt: AT - 1_800_000,
    });
    const fetch = explorer([
      call(`0x${"13".repeat(32)}`, PAID, "2026-10-27T05:50:30Z"),
      // Before its block: someone else's deposit of the same amount.
      call(
        `0x${"14".repeat(32)}`,
        "400000000000000000",
        "2026-10-27T05:40:00Z"
      ),
      call(
        `0x${"15".repeat(32)}`,
        "400000000000000000",
        "2026-10-27T05:51:00Z"
      ),
    ]);

    await expect(
      findDepositArrival(ahead, [ahead], { fetch })
    ).resolves.toStrictEqual({
      at: expect.any(Number),
      blockNumber: "1",
      hash: `0x${"13".repeat(32)}`,
    });
    await expect(
      findDepositArrival(behind, [behind], { fetch })
    ).resolves.toStrictEqual({
      at: expect.any(Number),
      blockNumber: "1",
      hash: `0x${"15".repeat(32)}`,
    });
  });

  it("isn't looked for until its Dusk block's time is known, and takes no payment from one whose time is", async () => {
    const unknown = kept("a1".repeat(32), "500000000", AT - 300_000, {
      l1BlockTimestamp: null,
    });
    const known = kept("a2".repeat(32), "500000000", AT);
    const fetch = explorer([
      call(`0x${"13".repeat(32)}`, PAID, "2026-10-27T05:51:00Z"),
    ]);

    await expect(
      findDepositArrival(unknown, [unknown, known], { fetch })
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      findDepositArrival(known, [unknown, known], { fetch })
    ).resolves.toStrictEqual({
      at: expect.any(Number),
      blockNumber: "1",
      hash: `0x${"13".repeat(32)}`,
    });
  });
});
