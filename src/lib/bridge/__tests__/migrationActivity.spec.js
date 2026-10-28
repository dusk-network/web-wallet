import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { networks } from "@dusk-network/networks";

import { cardRoutes } from "../cardRoutes";

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
 * A history row.
 *
 * @param {Partial<ActivityRow>} fields
 * @returns {ActivityRow}
 */
const row = (fields) => ({
  amount: String(5n * DUSK),
  direction: "in",
  hash: "bb".repeat(32),
  privacy: "public",
  source: "archive",
  status: "executed",
  timestamp: Date.UTC(2026, 9, 27, 7, 26),
  ...fields,
});

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  activity = await import("../migrationActivity");
  tracking = await import("../routeTracking");
});

afterEach(() => {
  localStorage.clear();
});

describe("migrations into Dusk", () => {
  it("are paid once the route's payout account pays this account the amount, with the migration's hash as the memo", () => {
    activity.rememberMigration({
      amountLux: String(5n * DUSK),
      createdAt: Date.UTC(2026, 9, 27, 6, 20),
      hash: MIGRATION.toUpperCase().replace("0X", "0x"),
      recipient: ACCOUNT,
      routeId: "bsc-to-dusk",
      sender: EVM,
    });

    const sent = get(activity.keptMigrations);

    expect(activity.migrationTransfers([], sent, ROUTES)).toMatchObject([
      { hash: MIGRATION, kind: "migration", stage: "sending" },
    ]);

    // Anyone can send a transfer with that memo: only the payout account's,
    // of exactly the amount, pays it.
    const elsewhere = row({ counterparty: ACCOUNT, memo: MIGRATION });
    const less = row({
      amount: String(4n * DUSK),
      counterparty: BSC.payoutAccount,
      memo: MIGRATION,
    });

    expect(
      activity.migrationTransfers([elsewhere, less], sent, ROUTES)[0].stage
    ).toBe("sending");

    const payout = row({ counterparty: BSC.payoutAccount, memo: MIGRATION });

    expect(activity.migrationTransfers([payout], sent, ROUTES)).toMatchObject([
      {
        paidAt: payout.timestamp,
        payout: payout.hash,
        route: { id: "bsc-to-dusk" },
        stage: "paid",
      },
    ]);
  });

  it("include the payouts in the history of migrations sent elsewhere, and keep the ones that failed as failed", () => {
    const payout = row({
      counterparty: BSC.payoutAccount,
      memo: `0x${"c3".repeat(32)}`,
    });

    expect(activity.migrationTransfers([payout], [], ROUTES)).toMatchObject([
      { hash: `0x${"c3".repeat(32)}`, stage: "paid" },
    ]);

    activity.rememberMigration({
      amountLux: String(DUSK),
      createdAt: 1,
      hash: MIGRATION,
      recipient: ACCOUNT,
      routeId: "bsc-to-dusk",
      sender: EVM,
    });
    activity.markMigrationFailed(MIGRATION);

    expect(
      activity.migrationTransfers([], get(activity.keptMigrations), ROUTES)
    ).toMatchObject([{ stage: "failed" }]);
  });

  it("know when their transaction reverted on its chain", async () => {
    activity.rememberMigration({
      amountLux: String(DUSK),
      createdAt: 1,
      hash: MIGRATION,
      recipient: ACCOUNT,
      routeId: "bsc-to-dusk",
      sender: EVM,
    });

    const [transfer] = activity.migrationTransfers(
      [],
      get(activity.keptMigrations),
      ROUTES
    );

    await expect(
      tracking.checkMigration(transfer, async () => null)
    ).resolves.toBeNull();
    await expect(
      tracking.checkMigration(transfer, async () => ({ status: "0x1" }))
    ).resolves.toBe(true);
    // In a block, it's sent, and waits for its payout.
    expect(
      activity.migrationTransfers([], get(activity.keptMigrations), ROUTES)
    ).toMatchObject([{ stage: "sent" }]);
    await expect(
      tracking.checkMigration(transfer, async () => ({ status: "0x0" }))
    ).resolves.toBe(false);
    expect(get(activity.keptMigrations)[0].failed).toBe(true);
  });
});

describe("following transfers to and from other chains", () => {
  it("reads a migration's chain until it's in a block, a transfer out's until it arrives, and nothing for the rest", async () => {
    /** @type {string[]} */
    const reads = [];
    const rpcFor = (/** @type {string} */ url) =>
      /** @type {import("../routeTracking").ChainRpc} */ (
        async (method, params) => {
          reads.push(`${url} ${method}`);

          return method === "eth_getBlockByNumber"
            ? { number: "0x10", timestamp: "0x10" }
            : method === "eth_getLogs"
              ? []
              : params[0] === MIGRATION
                ? { status: "0x1" }
                : null;
        }
      );

    activity.rememberMigration({
      amountLux: String(DUSK),
      createdAt: 1,
      hash: MIGRATION,
      recipient: ACCOUNT,
      routeId: "bsc-to-dusk",
      sender: EVM,
    });

    const sentOut = row({
      counterparty: TO_BSC.account,
      direction: "out",
      hash: "dd".repeat(32),
      memo: EVM,
    });
    const transfers = () => [
      ...activity.migrationTransfers([], get(activity.keptMigrations), ROUTES),
      ...activity.serviceTransfers(
        [sentOut, { ...sentOut, hash: "ee".repeat(32), memo: "alice" }],
        get(activity.transferArrivals),
        ROUTES
      ),
    ];

    await tracking.followTransfers(transfers(), {}, rpcFor);

    expect(reads).toStrictEqual([
      `${BSC.chain.rpcUrl} eth_getTransactionReceipt`,
      `${TO_BSC.chain.rpcUrl} eth_getBlockByNumber`,
      `${TO_BSC.chain.rpcUrl} eth_getBlockByNumber`,
      `${TO_BSC.chain.rpcUrl} eth_getLogs`,
    ]);

    // The migration is in a block now, and the transfer out arrived.
    activity.keepArrival(sentOut.hash, { arrivedAt: 2, payout: "0x1f" });
    reads.length = 0;

    await tracking.followTransfers(transfers(), {}, rpcFor);

    expect(reads).toStrictEqual([]);
  });
});

describe("transfers out to BNB Smart Chain", () => {
  const sent = row({
    amount: String(200_001n * DUSK),
    counterparty: TO_BSC.account,
    direction: "out",
    hash: "dd".repeat(32),
    memo: EVM,
    timestamp: Date.UTC(2026, 9, 27, 11, 55),
  });

  it("are sent until they arrive, and pay nothing out at or under the bridge fee, or without an address as the memo", () => {
    expect(activity.serviceTransfers([sent], {}, ROUTES)).toMatchObject([
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
        ROUTES
      )
    ).toMatchObject([{ arrivedAt: 2, payout: "0x1f77", stage: "arrived" }]);
    expect(
      activity
        .serviceTransfers(
          [
            { ...sent, amount: String(DUSK) },
            { ...sent, hash: "ee".repeat(32), memo: "alice" },
            { ...sent, hash: "ff".repeat(32), status: "failed" },
          ],
          {},
          ROUTES
        )
        .map(({ failure }) => failure)
    ).toStrictEqual([
      "It was no more than the bridge fee: nothing is paid out",
      "The memo isn't an address: the bridge can't pay it out",
      "The transfer failed on Dusk",
    ]);
    // Received from the route's account isn't a transfer out.
    expect(
      activity.serviceTransfers([{ ...sent, direction: "in" }], {}, ROUTES)
    ).toStrictEqual([]);
  });

  it("arrive with the token transfer to the memo's address of the amount less the fee, searched from about when sent", async () => {
    const [transfer] = activity.serviceTransfers([sent], {}, ROUTES);
    const head = 130_200_000n;
    /** BNB Smart Chain's pace: a block every 0.45 s. */
    const timeAt = (/** @type {bigint} */ n) =>
      Math.floor(Date.UTC(2026, 9, 28, 0, 0) / 1_000 - Number(head - n) * 0.45);
    /** @type {any[]} */
    const searched = [];
    const payout = `0x${"1f".repeat(32)}`;
    /** @type {import("../routeTracking").ChainRpc} */
    const rpc = async (method, params) => {
      if (method === "eth_getBlockByNumber") {
        const n = params[0] === "latest" ? head : BigInt(String(params[0]));

        return {
          number: `0x${n.toString(16)}`,
          timestamp: `0x${timeAt(n).toString(16)}`,
        };
      }

      const [filter] = /** @type {any[]} */ (params);

      searched.push(filter);

      // The payout, 10 hours after it was sent.
      const at = head - BigInt(Math.round((2 * 3_600) / 0.45));

      return BigInt(filter.fromBlock) <= at && at <= BigInt(filter.toBlock)
        ? [
            {
              blockNumber: `0x${at.toString(16)}`,
              data: `0x${(200_000n * DUSK * 1_000_000_000n).toString(16)}`,
              transactionHash: payout,
            },
          ]
        : [];
    };

    // A check searches a few windows, and keeps where it got to.
    await expect(tracking.searchArrival(transfer, { rpc })).resolves.toBeNull();
    expect(searched[0]).toMatchObject({
      address: TO_BSC.chain.token,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        null,
        `0x${"0".repeat(24)}${EVM.slice(2)}`,
      ],
    });

    const { scanFrom } = get(activity.transferArrivals)[sent.hash];

    expect(BigInt(scanFrom ?? 0)).toBeGreaterThan(
      BigInt(searched[0].fromBlock)
    );

    // Until it's found, on later checks.
    /** @type {any} */
    let found = null;

    for (let i = 0; i < 20 && !found; i++) {
      found = await tracking.searchArrival(transfer, {
        rpc,
        scanFrom: get(activity.transferArrivals)[sent.hash].scanFrom,
      });
    }

    expect(found).toMatchObject({ payout });
    expect(get(activity.transferArrivals)[sent.hash]).toMatchObject({ payout });
    // Another transfer of the same isn't paid with it.
    await expect(
      tracking.searchArrival(
        { ...transfer, hash: "ab".repeat(32) },
        { rpc, scanFrom: searched[0].fromBlock, taken: new Set([payout]) }
      )
    ).resolves.toBeNull();
  });
});
