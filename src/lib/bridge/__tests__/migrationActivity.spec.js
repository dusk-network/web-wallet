import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { TRANSFER_TOPIC } from "@dusk-network/app-core/bridge";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";

import { cardRoutes } from "../cardRoutes";
import { fakeChain, topicOf, wordOf } from "./fixtures/chain";

/** The archive, as `/bridge` reads a transfer out and its route's account. */
const archive = vi.hoisted(() => ({
  /** Transactions as `tx(hash) { … tx { memo json } }` gives them, by hash. */
  /** @type {Record<string, any>} */
  transactions: {},
}));

vi.mock("$lib/activity/activityHistory", () => ({
  archiveAt: () => ({
    /** @param {string} query */
    query: async (query) =>
      // What the route's account received before: nothing.
      query.includes("moonlightHistory")
        ? { in: null }
        : Object.fromEntries(
            [
              ...query.matchAll(
                /(x\d+): tx\(hash: "([0-9a-f]{64})"\) \{ blockHeight/g
              ),
            ].map(([, key, hash]) => [key, archive.transactions[hash] ?? null])
          ),
  }),
}));

/** @type {typeof import("../migrationActivity")} */
let activity;

/** @type {typeof import("../routeTracking")} */
let tracking;

const ROUTES = cardRoutes(networks.mainnet);
const BSC =
  /** @type {Extract<import("../cardRoutes").CardRoute, { kind: "migration" }>} */ (
    ROUTES.find(({ id }) => id === "bsc-to-dusk")
  );
const TO_BSC =
  /** @type {Extract<import("../cardRoutes").CardRoute, { kind: "service" }>} */ (
    ROUTES.find(({ id }) => id === "dusk-to-bsc")
  );
const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const MIGRATION = `0x${"a6".repeat(32)}`;
const EVM = "0x1111111111111111111111111111111111111111";
const DUSK = 1_000_000_000n;

/**
 * A history row, by default a public transfer received.
 *
 * @param {Record<string, unknown>} fields
 */
const row = (fields) =>
  rowOf({
    amount: String(5n * DUSK),
    blockHeight: 4_700_000,
    direction: "in",
    hash: "bb".repeat(32),
    status: "executed",
    timestamp: Date.UTC(2026, 9, 27, 7, 26),
    ...fields,
  });

/** @param {Partial<import("../migrationActivity").KeptMigration>} [fields] */
const remember = (fields) =>
  activity.rememberMigration({
    amountLux: String(5n * DUSK),
    createdAt: Date.UTC(2026, 9, 27, 6, 20),
    hash: MIGRATION,
    recipient: ACCOUNT,
    routeId: "bsc-to-dusk",
    sender: EVM,
    ...fields,
  });

/** @param {ActivityRow[]} rows */
const migrations = (rows) =>
  activity.migrationTransfers(
    rows,
    get(activity.keptMigrations),
    networks.mainnet,
    ACCOUNT
  );

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  activity = await import("../migrationActivity");
  tracking = await import("../routeTracking");
  (await import("$lib/stores/nodeNetwork")).setNodeNetwork(networks.mainnet);
  archive.transactions = {};
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("migrations into Dusk", () => {
  it("are sending until in a block, then paid once the history has their payout", async () => {
    remember({ hash: MIGRATION.toUpperCase().replace("0X", "0x") });

    await expect(migrations([])).resolves.toMatchObject([
      { hash: MIGRATION, kind: "migration", stage: "sending" },
    ]);

    // From the route's payout account, the migration's hash as the memo.
    const payout = row({ counterparty: BSC.payoutAccount, memo: MIGRATION });

    await expect(migrations([payout])).resolves.toMatchObject([
      {
        paidAt: payout.time,
        payout: payout.hash,
        route: { id: "bsc-to-dusk" },
        stage: "paid",
      },
    ]);
  });

  it("list only those that pay the account the wallet shows, and are forgotten with the wallet", async () => {
    const other = `${ACCOUNT.slice(0, -4)}Zzzz`;

    remember({ recipient: other });
    activity.keepArrival("dd".repeat(32), { payout: `0x${"1f".repeat(32)}` });

    await expect(migrations([])).resolves.toStrictEqual([]);
    await expect(
      activity.migrationTransfers(
        [],
        get(activity.keptMigrations),
        networks.mainnet,
        other
      )
    ).resolves.toHaveLength(1);

    // Settings › Reset: nothing of it stays in this browser.
    activity.forgetRouteTransfers();

    expect(get(activity.keptMigrations)).toStrictEqual([]);
    expect(get(activity.transferArrivals)).toStrictEqual({});
    expect(localStorage.getItem("web-wallet-migrations")).toBeNull();
    expect(localStorage.getItem("web-wallet-transfer-arrivals")).toBeNull();
  });

  it("include the payouts in the history of migrations sent elsewhere, each once, and keep the ones that failed as failed", async () => {
    const payout = row({
      counterparty: BSC.payoutAccount,
      memo: `0x${"c3".repeat(32)}`,
    });
    const again = row({
      blockHeight: 4_700_100,
      counterparty: BSC.payoutAccount,
      hash: "b2".repeat(32),
      memo: `0x${"c3".repeat(32)}`,
    });

    // When it was sent isn't known from its payout: only when it was paid.
    await expect(migrations([payout, again])).resolves.toMatchObject([
      {
        at: null,
        hash: `0x${"c3".repeat(32)}`,
        paidAt: payout.time,
        stage: "paid",
      },
    ]);

    remember({ amountLux: String(DUSK), createdAt: 1 });
    activity.markMigrationFailed(MIGRATION);

    await expect(migrations([])).resolves.toMatchObject([{ stage: "failed" }]);
  });

  it("know when their transaction reverted on its chain", async () => {
    remember({ amountLux: String(DUSK), createdAt: 1 });

    const [transfer] = await migrations([]);

    await expect(
      tracking.checkMigration(transfer, async () => null)
    ).resolves.toBeNull();
    await expect(
      tracking.checkMigration(transfer, async () => ({ status: "0x1" }))
    ).resolves.toBe(true);
    // In a block, it's sent, and waits for its payout.
    await expect(migrations([])).resolves.toMatchObject([{ stage: "sent" }]);
    await expect(
      tracking.checkMigration(transfer, async () => ({ status: "0x0" }))
    ).resolves.toBe(false);
    expect(get(activity.keptMigrations)[0].failed).toBe(true);
  });
});

describe("following transfers to and from other chains", () => {
  it("reads a migration's chain until it's in a block, a transfer out's until it arrives, carrying on from where it got to, and nothing for the rest", async () => {
    const now = Date.now();
    const sentAt = now - 3 * 3_600_000;
    const out = row({
      amount: String(200_001n * DUSK),
      counterparty: TO_BSC.account,
      direction: "out",
      hash: "dd".repeat(32),
      memo: EVM,
      timestamp: sentAt,
    });
    // BNB Smart Chain: a block every 0.45 s.
    const bsc = fakeChain({
      blockMs: 450,
      head: 130_200_000n,
      headAt: now,
      logs: [],
      url: TO_BSC.chain.rpcUrl,
    });
    /** @type {string[]} */
    const receipts = [];
    const rpcFor = (/** @type {string} */ url) =>
      /** @type {import("../routeTracking").ChainRpc} */ (
        async (method, params) => {
          receipts.push(`${url} ${method}`);

          return params[0] === MIGRATION ? { status: "0x1" } : null;
        }
      );
    const transfers = async () => [
      ...(await migrations([])),
      ...activity.serviceTransfers(
        [out, row({ ...out, hash: "ee".repeat(32), memo: "alice" })],
        get(activity.transferArrivals),
        networks.mainnet
      ),
    ];
    const follow = async () =>
      tracking.followTransfers(
        await transfers(),
        get(activity.transferArrivals),
        rpcFor
      );

    vi.spyOn(globalThis, "fetch").mockImplementation(bsc.answer);
    // The transfer out, as the chain has it: to the route's account, the
    // address it pays as its memo.
    archive.transactions[out.hash] = {
      blockHeight: 4_700_000,
      blockTimestamp: sentAt / 1000,
      err: null,
      tx: {
        json: JSON.stringify({
          receiver: TO_BSC.account,
          type: "moonlight",
          value: String(200_001n * DUSK),
        }),
        memo: Buffer.from(EVM).toString("hex"),
      },
    };
    remember({ amountLux: String(DUSK), createdAt: 1 });

    // Not paid out yet: where the search got to is kept.
    await follow();

    expect(receipts).toStrictEqual([
      `${BSC.chain.rpcUrl} eth_getTransactionReceipt`,
    ]);
    expect(bsc.methods()).toContain("eth_getLogs");
    expect(get(activity.transferArrivals)[out.hash]).toStrictEqual({
      scan: expect.objectContaining({ from: "130200001" }),
    });

    // Paid out a minute later: the DUSK token's transfer from the route's
    // payout address to the memo's, of the amount less the fee. The next
    // check carries on from where the last one stopped.
    bsc.chain.head += 200n;
    bsc.chain.headAt += 90_000;
    bsc.chain.logs.push({
      address: String(TO_BSC.chain.token),
      block: 130_200_133n,
      data: `0x${wordOf(200_000n * DUSK * 1_000_000_000n)}`,
      hash: `0x${"1f".repeat(32)}`,
      topics: [
        TRANSFER_TOPIC,
        topicOf(String(TO_BSC.payoutAddress)),
        topicOf(EVM),
      ],
    });
    bsc.asked.length = 0;
    receipts.length = 0;

    await follow();

    expect(
      bsc.asked.find(({ method }) => method === "eth_getLogs")?.params[0]
    ).toMatchObject({ fromBlock: `0x${(130_200_001).toString(16)}` });
    expect(get(activity.transferArrivals)[out.hash]).toMatchObject({
      // Its block's time: 67 blocks before the head, 90 s on.
      arrivedAt: Math.floor((now + 90_000 - 67 * 450) / 1000) * 1000,
      payout: `0x${"1f".repeat(32)}`,
    });
    await expect(transfers()).resolves.toMatchObject([
      { kind: "migration", stage: "sent" },
      { hash: out.hash, stage: "arrived" },
      { stage: "failed" },
    ]);

    // The migration is in a block, and the transfer out arrived: nothing
    // more to read.
    bsc.asked.length = 0;

    await follow();

    expect([...receipts, ...bsc.methods()]).toStrictEqual([]);
  });
});

describe("transfers out to BNB Smart Chain", () => {
  const out = {
    amount: String(200_001n * DUSK),
    counterparty: TO_BSC.account,
    direction: "out",
    hash: "dd".repeat(32),
    memo: EVM,
    timestamp: Date.UTC(2026, 9, 27, 11, 55),
  };
  const sent = row(out);

  it("are sent until they arrive, and pay nothing out at or under the bridge fee, or without an address as the memo", () => {
    expect(
      activity.serviceTransfers([sent], {}, networks.mainnet)
    ).toMatchObject([
      {
        amountLux: 200_001n * DUSK,
        feeLux: DUSK,
        recipient: EVM,
        route: { id: "dusk-to-bsc" },
        stage: "sent",
      },
    ]);
    expect(
      activity.serviceTransfers(
        [sent],
        { [sent.hash]: { arrivedAt: 2, payout: "0x1f77" } },
        networks.mainnet
      )
    ).toMatchObject([{ arrivedAt: 2, payout: "0x1f77", stage: "arrived" }]);
    expect(
      activity
        .serviceTransfers(
          [
            row({ ...out, amount: String(DUSK) }),
            row({ ...out, hash: "ee".repeat(32), memo: "alice" }),
            row({ ...out, hash: "ff".repeat(32), status: "failed" }),
            // The wallet's own, which saw it fail before the history has it.
            row({
              ...out,
              counterparty: undefined,
              hash: "fe".repeat(32),
              source: "local",
              status: "failed",
              to: TO_BSC.account,
            }),
          ],
          {},
          networks.mainnet
        )
        .map(({ failure }) => failure)
    ).toStrictEqual([
      "It was no more than the bridge fee: nothing is paid out",
      "The memo isn't an address: the bridge can't pay it out",
      "The transfer failed on Dusk",
      "The transfer failed on Dusk",
    ]);
    // Received from the route's account isn't a transfer out.
    expect(
      activity.serviceTransfers(
        [row({ ...out, direction: "in" })],
        {},
        networks.mainnet
      )
    ).toStrictEqual([]);
  });
});
