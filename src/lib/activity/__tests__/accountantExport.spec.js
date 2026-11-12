import { afterEach, describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";

import {
  REWARDS_AGAIN_MS,
  followRewardsByYear,
  makeExport,
  savedWords,
} from "../accountantExport";
import { rowOf } from "./fixtures/rows";

// Nandini's two profiles, and an EVM address each migrated from on the BSC
// test chain: Profile 1 from 0x7cdb…, connected here, and Profile 2 from
// 0xb746…, in a browser of its own. Each bridged DUSK out to its own.
const PROFILE_1 =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const PROFILE_2 =
  "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";
const ITS_EVM = `0x7cdb${"0".repeat(32)}8e73`;
const OTHER_EVM = `0xb746${"0".repeat(32)}aa25`;
const RPC = "https://anvil.testnet.example";
const TOKEN = "0xbcee5c06eda885a6471a0e87f513e7492d411b61";
const CONTRACT = "0x93d6e214d07e6a548005ded9a3da589c29f830fe";
const ROUTE_ACCOUNT =
  "yUdHBN8BBNiL5X6CWH1u5KdXqq8dBg1JAQiHcJTjvfxBvrVawoqWHqtKNp4gnpgStvWzVrrpB6mA57Jd6q8LQpiAszL3ewjykbNJpJkhR6WrecP7KkBb36hxSP7sgmsoGhq";

/** Testnet, with the BSC test chain's routes the live wallet has. */
const net = /** @type {any} */ ({
  ...networks.testnet,
  routes: {
    chains: {
      bsc: {
        chainId: 745745,
        currency: { decimals: 18, name: "Test Ether", symbol: "ETH" },
        explorerUrl: RPC,
        name: "BSC test chain",
        rpcUrl: RPC,
        token: TOKEN,
        tokenLabel: "BEP20 DUSK",
      },
    },
    duskEvm: [],
    migrations: [
      {
        chain: "bsc",
        contract: CONTRACT,
        id: "bsc-to-dusk",
        payoutAccount: ROUTE_ACCOUNT,
        running: true,
        typicalSeconds: 30,
      },
    ],
    retired: [],
    services: [
      {
        account: ROUTE_ACCOUNT,
        chain: "bsc",
        feeLux: "100000000",
        id: "dusk-to-bsc",
        payoutAddress: "0xaddf28c796715f6749a6eeb03a4b0cefbd05b9fd",
        running: true,
        typicalSeconds: 60,
      },
    ],
  },
});

/** @param {bigint | number} n */
const hex = (n) => `0x${BigInt(n).toString(16)}`;

/** @param {string} address */
const topicOf = (address) =>
  `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

/** @param {bigint} n */
const word = (n) => `0x${n.toString(16).padStart(64, "0")}`;

const APPROVAL =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CENT = 10_000_000_000_000_000n;

/** A transaction on the BSC test chain, by its number. */
const tx = (/** @type {number} */ n) => `0x${n.toString(16).padStart(64, "0")}`;

// 0x7cdb…: an approval, the migration that drew on it into Profile 1, and a
// revoke after. 0xb746…: the same, into Profile 2.
const ITS_APPROVAL = tx(1);
const ITS_MIGRATION = tx(2);
const ITS_REVOKE = tx(3);
const OTHER_APPROVAL = tx(4);
const OTHER_MIGRATION = tx(5);
const OTHER_REVOKE = tx(6);
// 0x5a1e…, connected here: an approval, and no migration.
const NEVER_EVM = `0x5a1e${"0".repeat(32)}f00d`;
const NEVER_APPROVAL = tx(7);

/**
 * @param {string} hash
 * @param {number} block
 * @param {string} topic
 * @param {string} owner
 * @param {bigint} value
 * @param {number} [index]
 */
const logOf = (hash, block, topic, owner, value, index = 0) => ({
  address: TOKEN,
  blockNumber: hex(block),
  data: word(value),
  logIndex: hex(index),
  removed: false,
  topics: [topic, topicOf(owner), topicOf(CONTRACT)],
  transactionHash: hash,
});

const logs = [
  logOf(ITS_APPROVAL, 0x100, APPROVAL, ITS_EVM, CENT),
  logOf(ITS_MIGRATION, 0x101, TRANSFER, ITS_EVM, CENT),
  logOf(ITS_MIGRATION, 0x101, APPROVAL, ITS_EVM, 0n, 1),
  logOf(ITS_REVOKE, 0x102, APPROVAL, ITS_EVM, 0n),
  logOf(OTHER_APPROVAL, 0x110, APPROVAL, OTHER_EVM, 5n * CENT),
  logOf(OTHER_MIGRATION, 0x111, TRANSFER, OTHER_EVM, 5n * CENT),
  logOf(OTHER_MIGRATION, 0x111, APPROVAL, OTHER_EVM, 0n, 1),
  logOf(OTHER_REVOKE, 0x112, APPROVAL, OTHER_EVM, 0n),
  logOf(NEVER_APPROVAL, 0x120, APPROVAL, NEVER_EVM, CENT),
];

/**
 * @param {string} hash
 * @param {number} block
 * @param {string} from
 * @param {string} to
 */
const receiptOf = (hash, block, from, to) => ({
  blockNumber: hex(block),
  effectiveGasPrice: "0x3b9aca10",
  from,
  gasUsed: "0xb466",
  logs: logs.filter((log) => log.transactionHash === hash),
  status: "0x1",
  to,
  transactionHash: hash,
});

/** @type {Record<string, ReturnType<typeof receiptOf>>} */
const receipts = {
  [ITS_APPROVAL]: receiptOf(ITS_APPROVAL, 0x100, ITS_EVM, TOKEN),
  [ITS_MIGRATION]: receiptOf(ITS_MIGRATION, 0x101, ITS_EVM, CONTRACT),
  [ITS_REVOKE]: receiptOf(ITS_REVOKE, 0x102, ITS_EVM, TOKEN),
  [OTHER_APPROVAL]: receiptOf(OTHER_APPROVAL, 0x110, OTHER_EVM, TOKEN),
  [OTHER_MIGRATION]: receiptOf(OTHER_MIGRATION, 0x111, OTHER_EVM, CONTRACT),
  [OTHER_REVOKE]: receiptOf(OTHER_REVOKE, 0x112, OTHER_EVM, TOKEN),
  [NEVER_APPROVAL]: receiptOf(NEVER_APPROVAL, 0x120, NEVER_EVM, TOKEN),
};

/** A block's time, in seconds: 5 November 2026, from 03:00 UTC, a minute a block. */
const timeAt = (/** @type {bigint} */ n) =>
  Date.UTC(2026, 10, 5, 3) / 1000 + Number(n - 0x100n) * 60;

/**
 * The BSC test chain's JSON-RPC, as it answers.
 *
 * @param {string} url
 * @param {{ body: string }} init
 */
async function chain(url, { body }) {
  const { id, method, params } = JSON.parse(body);
  const head = 0x200n;
  /** @param {unknown} result */
  const answer = (result) =>
    new Response(JSON.stringify({ id, jsonrpc: "2.0", result }), {
      headers: { "content-type": "application/json" },
    });

  expect(url).toBe(RPC);

  switch (method) {
    case "eth_blockNumber":
      return answer(hex(head));

    case "eth_getBlockByNumber": {
      const n = params[0] === "latest" ? head : BigInt(params[0]);

      return answer({ number: hex(n), timestamp: hex(timeAt(n)) });
    }

    case "eth_getTransactionReceipt":
      return answer(receipts[String(params[0]).toLowerCase()] ?? null);

    case "eth_getLogs": {
      const [{ fromBlock, toBlock, topics }] = params;

      return answer(
        logs.filter(
          (log) =>
            BigInt(log.blockNumber) >= BigInt(fromBlock) &&
            BigInt(log.blockNumber) <= BigInt(toBlock) &&
            topics.every(
              (
                /** @type {string | string[] | null} */ topic,
                /** @type {number} */ i
              ) =>
                topic === null ||
                (Array.isArray(topic)
                  ? topic.includes(log.topics[i])
                  : topic === log.topics[i])
            )
        )
      );
    }

    default:
      return answer(null);
  }
}

// The migrations this browser sent: Profile 1's, from the address connected
// here, its approval kept with it.
vi.mock("$lib/bridge/migrationActivity", async () => {
  const { readable } = await import("svelte/store");

  return {
    keptMigrations: readable([
      {
        amountLux: "10000000",
        approval: `0x${"01".padStart(64, "0")}`,
        createdAt: Date.UTC(2026, 10, 5, 3),
        hash: `0x${"02".padStart(64, "0")}`,
        recipient:
          "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi",
        routeId: "bsc-to-dusk",
        sender: `0x7cdb${"0".repeat(32)}8e73`,
      },
    ]),
  };
});

/**
 * A profile's whole history: a bridge-out to its EVM address, and the payout
 * of its migration from there, a minute after it.
 *
 * @param {string} account
 * @param {string} evm
 * @param {string} migration
 * @param {number} n
 */
const historyOf = (account, evm, migration, n) => [
  rowOf(
    {
      amount: "150000000",
      blockHeight: 4_800_000 + n,
      counterparty: ROUTE_ACCOUNT,
      direction: "out",
      feePaid: "1859344",
      hash: `${n}a`.padStart(64, "0"),
      memo: evm,
      status: "executed",
      timestamp: Date.UTC(2026, 10, 5, 2, 40 + n),
    },
    { account, network: net }
  ),
  rowOf(
    {
      amount: String(BigInt(receipts[migration].logs[0].data) / 10n ** 9n),
      blockHeight: 4_800_100 + n,
      counterparty: ROUTE_ACCOUNT,
      direction: "in",
      hash: `${n}b`.padStart(64, "0"),
      memo: migration,
      status: "executed",
      timestamp: (timeAt(BigInt(receipts[migration].blockNumber)) + 60) * 1000,
    },
    { account, network: net }
  ),
];

/**
 * A profile's file, as History's Export makes it with the EVM wallet given
 * connected.
 *
 * @param {string} account
 * @param {any[]} rows
 * @param {string[]} [evmConnected]
 * @param {import("@dusk-network/app-core/export").ExportProfile[]} [profiles]
 *   The person's others
 */
const fileOf = (account, rows, evmConnected = [ITS_EVM], profiles = []) =>
  makeExport({
    choices: {
      excel: false,
      fiat: false,
      from: "",
      period: "all",
      to: "",
      withContacts: false,
    },
    contactName: () => null,
    evmConnected,
    net,
    network: "testnet",
    profile: {
      account,
      name: account === PROFILE_1 ? "Profile 1" : "Profile 2",
    },
    profiles,
    session: {
      sozuFacts: async () => new Map(),
      whole: async () => ({ rows, shieldedWaiting: false }),
    },
  });

/** @param {string} csv */
const recordsOf = (csv) => {
  const [head, ...lines] = csv.trimEnd().split("\r\n");
  const columns = head.split(",");

  return lines.map((line) =>
    Object.fromEntries(line.split(",").map((cell, i) => [columns[i], cell]))
  );
};

describe("History's Export", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("books each EVM gas line once, in the file of the profile its migration paid: Profile 2's its own migration's, none of the address connected here, whose migrations paid Profile 1", async () => {
    vi.stubGlobal("fetch", vi.fn(chain));

    const one = await fileOf(
      PROFILE_1,
      historyOf(PROFILE_1, ITS_EVM, ITS_MIGRATION, 1)
    );
    const two = await fileOf(
      PROFILE_2,
      historyOf(PROFILE_2, OTHER_EVM, OTHER_MIGRATION, 2)
    );
    /** @param {{ csv: string }} file */
    const gas = ({ csv }) =>
      recordsOf(csv)
        .filter((record) => record["Sent Currency"] === "ETH")
        .map((record) => [record.TxHash, record.Account]);

    expect(gas(one)).toStrictEqual([
      [ITS_APPROVAL, ITS_EVM],
      [ITS_MIGRATION, ITS_EVM],
      [ITS_REVOKE, ITS_EVM],
    ]);
    // Its revoke too, found as the address it bridged to: never connected here.
    expect(gas(two)).toStrictEqual([
      [OTHER_APPROVAL, OTHER_EVM],
      [OTHER_MIGRATION, OTHER_EVM],
      [OTHER_REVOKE, OTHER_EVM],
    ]);

    // Each says whose network fees it has.
    expect(one.evm).toStrictEqual({
      approvalsUnread: [],
      booked: [ITS_EVM],
      unread: [],
    });
    expect(two.evm).toStrictEqual({
      approvalsUnread: [],
      booked: [OTHER_EVM],
      unread: [],
    });
    expect(savedWords(two)).toContain(
      "The file has the network fees paid from 0xB746…aa25."
    );
    expect(savedWords(two).toLowerCase()).not.toContain("0x7cdb");
  });

  it("says once saved which network fees it couldn't read: a migration's, approvals for now, and those before a block it reads back to", () => {
    expect(
      savedWords({
        count: 3,
        csv: "",
        currency: "EUR",
        evm: {
          approvalsUnread: [
            {
              chain: "BSC test chain",
              from: null,
              owner: OTHER_EVM,
              state: "error",
            },
            {
              chain: "Sepolia",
              from: 4_200_000,
              owner: ITS_EVM,
              state: "beyond",
            },
          ],
          booked: [ITS_EVM],
          unread: [{ chain: "BSC test chain", hash: ITS_MIGRATION }],
        },
        fileName: "dusk-profile-1-testnet-all.csv",
        hasOtherProfiles: false,
        left: { notRead: 0, outOfPeriod: 0, pending: 0 },
        shieldedWaiting: false,
        unpriced: 0,
      })
    ).toBe(
      "CSV saved: 3 lines. The file has the network fees paid from 0x7cdb…8e73. 1 migration's fee on BSC test chain couldn't be read: export again to add it. Some network fees on BSC test chain couldn't be read: export again to add them. Network fees on Sepolia from before block 4,200,000 aren't in the file."
    );
  });

  it("says an approval of an address connected here that never migrated may be in another profile's file, where the first profile's books it", async () => {
    vi.stubGlobal("fetch", vi.fn(chain));

    // Connected for both: Profile 1, first by its account, books it.
    const one = await fileOf(
      PROFILE_1,
      historyOf(PROFILE_1, ITS_EVM, ITS_MIGRATION, 1),
      [ITS_EVM, NEVER_EVM],
      [{ account: PROFILE_2, name: "Profile 2" }]
    );
    const two = await fileOf(
      PROFILE_2,
      historyOf(PROFILE_2, OTHER_EVM, OTHER_MIGRATION, 2),
      [NEVER_EVM],
      [{ account: PROFILE_1, name: "Profile 1" }]
    );

    expect(one.csv).toContain(NEVER_APPROVAL);
    expect(savedWords(one)).not.toContain("Some network fees");
    expect(two.csv).not.toContain(NEVER_APPROVAL);
    expect(savedWords(two)).toContain(
      "Some network fees on BSC test chain may be in another profile's file, or couldn't be read: export again to add them."
    );
    expect(savedWords(two)).not.toContain(
      "Some network fees on BSC test chain couldn't be read"
    );
  });

  it("books a bridge-out's fee in the fee column, with what reached the other side as sent", async () => {
    vi.stubGlobal("fetch", vi.fn(chain));

    const [out] = recordsOf(
      (
        await fileOf(
          PROFILE_2,
          historyOf(PROFILE_2, OTHER_EVM, OTHER_MIGRATION, 2)
        )
      ).csv
    ).filter((record) => record["Sent Currency"] === "DUSK");

    expect(out).toMatchObject({
      "Fee Amount": "0.101859344",
      "Sent Amount": "0.05",
    });
  });

  it("writes no gas of a migration from an EVM address not known as the person's, as a customer's to a shop, and writes it once that one's connected", async () => {
    vi.stubGlobal("fetch", vi.fn(chain));

    // A customer migrated to the shop's account: it never bridged to them.
    const [, payout] = historyOf(PROFILE_2, OTHER_EVM, OTHER_MIGRATION, 2);
    const costs = async (/** @type {string[]} */ connected) =>
      recordsOf((await fileOf(PROFILE_2, [payout], connected)).csv).filter(
        (record) => record["Sent Currency"] === "ETH"
      );

    expect(await costs([])).toStrictEqual([]);
    expect(
      (await costs([OTHER_EVM.toUpperCase().replace("0X", "0x")])).map(
        (record) => record.TxHash
      )
    ).toStrictEqual([OTHER_APPROVAL, OTHER_MIGRATION, OTHER_REVOKE]);
  });
});

describe("Staking rewards by year", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads them again while a new Sozu stake's facts aren't read yet, keeping what was read meanwhile, and stops once they are", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const now = Date.now();
    const [claim, staked] = [
      rowOf({
        amount: "1000000000",
        blockHeight: 4_000_000,
        direction: "in",
        hash: "f1".repeat(32),
        kind: "withdraw_reward",
        status: "executed",
        timestamp: now - 3_600_000,
      }),
      {
        ...rowOf({
          amount: "10000000000",
          blockHeight: 4_000_100,
          direction: "out",
          hash: "f2".repeat(32),
          kind: "transfer",
          status: "executed",
          timestamp: now - 60_000,
        }),
        sozu: /** @type {const} */ ("stake"),
      },
    ];
    const facts = vi
      .fn()
      // The archive doesn't list its event yet.
      .mockResolvedValueOnce(new Map())
      .mockResolvedValue(
        new Map([
          [
            staked.hash,
            {
              fee: 25_000_000n,
              pool: { stake: 1_995n, supply: 1_000n },
              stDusk: 5_000_000_000n,
            },
          ],
        ])
      );
    /** @type {any[]} */
    const read = [];
    const stop = followRewardsByYear(
      {
        currency: "EUR",
        fiat: false,
        session: {
          sozuFacts: facts,
          whole: async () => ({
            rows: [claim, staked],
            shieldedWaiting: false,
          }),
        },
        sozuStatus: async () => null,
      },
      { onError: (error) => read.push(error), onRead: (got) => read.push(got) }
    );

    await vi.waitFor(() => expect(read).toHaveLength(1));

    const [first] = read;
    const year = new Date(now).getFullYear();

    // The year as it was before it: never "couldn't be read".
    expect(first.years).toEqual([
      expect.objectContaining({
        claimed: expect.objectContaining({ lux: 1_000_000_000n }),
        reading: 1,
        year,
      }),
    ]);
    expect(first.years[0].sozuGrown).not.toBeNull();

    await vi.advanceTimersByTimeAsync(REWARDS_AGAIN_MS);
    await vi.waitFor(() => expect(read).toHaveLength(2));

    expect(read[1].years).toEqual([expect.objectContaining({ reading: 0 })]);

    // Read: it isn't read again.
    await vi.advanceTimersByTimeAsync(REWARDS_AGAIN_MS * 3);

    expect(read).toHaveLength(2);
    expect(facts).toHaveBeenCalledTimes(2);
    stop();
  });
});
