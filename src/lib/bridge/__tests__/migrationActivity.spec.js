import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";

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
 * A history row, by default a public transfer received.
 *
 * @param {Record<string, unknown>} fields
 */
const row = (fields) =>
  rowOf({
    amount: String(5n * DUSK),
    direction: "in",
    hash: "bb".repeat(32),
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

    expect(
      activity.migrationTransfers([], sent, ROUTES, ACCOUNT)
    ).toMatchObject([{ hash: MIGRATION, kind: "migration", stage: "sending" }]);

    // Anyone can send a transfer with that memo: only the payout account's,
    // of exactly the amount, pays it.
    const elsewhere = row({ counterparty: ACCOUNT, memo: MIGRATION });
    const less = row({
      amount: String(4n * DUSK),
      counterparty: BSC.payoutAccount,
      memo: MIGRATION,
    });

    expect(
      activity.migrationTransfers([elsewhere, less], sent, ROUTES, ACCOUNT)[0]
        .stage
    ).toBe("sending");

    const payout = row({ counterparty: BSC.payoutAccount, memo: MIGRATION });

    expect(
      activity.migrationTransfers([payout], sent, ROUTES, ACCOUNT)
    ).toMatchObject([
      {
        paidAt: payout.time,
        payout: payout.hash,
        route: { id: "bsc-to-dusk" },
        stage: "paid",
      },
    ]);
  });

  it("list only those that pay the account the wallet shows, and are forgotten with the wallet", () => {
    const other = `${ACCOUNT.slice(0, -4)}Zzzz`;

    activity.rememberMigration({
      amountLux: String(DUSK),
      createdAt: 1,
      hash: MIGRATION,
      recipient: other,
      routeId: "bsc-to-dusk",
      sender: EVM,
    });
    activity.keepArrival("dd".repeat(32), { scanFrom: "1" });

    const sent = get(activity.keptMigrations);

    expect(
      activity.migrationTransfers([], sent, ROUTES, ACCOUNT)
    ).toStrictEqual([]);
    expect(activity.migrationTransfers([], sent, ROUTES, other)).toHaveLength(
      1
    );

    // Settings › Reset: nothing of it stays in this browser.
    activity.forgetRouteTransfers();

    expect(get(activity.keptMigrations)).toStrictEqual([]);
    expect(get(activity.transferArrivals)).toStrictEqual({});
    expect(localStorage.getItem("web-wallet-migrations")).toBeNull();
    expect(localStorage.getItem("web-wallet-transfer-arrivals")).toBeNull();
  });

  it("include the payouts in the history of migrations sent elsewhere, and keep the ones that failed as failed", () => {
    const payout = row({
      counterparty: BSC.payoutAccount,
      memo: `0x${"c3".repeat(32)}`,
    });

    // When it was sent isn't known from its payout: only when it was paid.
    expect(
      activity.migrationTransfers([payout], [], ROUTES, ACCOUNT)
    ).toMatchObject([
      {
        at: null,
        hash: `0x${"c3".repeat(32)}`,
        paidAt: payout.time,
        stage: "paid",
      },
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
      activity.migrationTransfers(
        [],
        get(activity.keptMigrations),
        ROUTES,
        ACCOUNT
      )
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
      ROUTES,
      ACCOUNT
    );

    await expect(
      tracking.checkMigration(transfer, async () => null)
    ).resolves.toBeNull();
    await expect(
      tracking.checkMigration(transfer, async () => ({ status: "0x1" }))
    ).resolves.toBe(true);
    // In a block, it's sent, and waits for its payout.
    expect(
      activity.migrationTransfers(
        [],
        get(activity.keptMigrations),
        ROUTES,
        ACCOUNT
      )
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

    const out = {
      counterparty: TO_BSC.account,
      direction: "out",
      hash: "dd".repeat(32),
      memo: EVM,
    };
    const sentOut = row(out);
    const transfers = () => [
      ...activity.migrationTransfers(
        [],
        get(activity.keptMigrations),
        ROUTES,
        ACCOUNT
      ),
      ...activity.serviceTransfers(
        [sentOut, row({ ...out, hash: "ee".repeat(32), memo: "alice" })],
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
            row({ ...out, amount: String(DUSK) }),
            row({ ...out, hash: "ee".repeat(32), memo: "alice" }),
            row({ ...out, hash: "ff".repeat(32), status: "failed" }),
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
      activity.serviceTransfers([row({ ...out, direction: "in" })], {}, ROUTES)
    ).toStrictEqual([]);
  });

  it("arrive with the token transfer from the route's payout address to the memo's address of the amount less the fee, searched from about when sent", async () => {
    const [transfer] = activity.serviceTransfers([sent], {}, ROUTES);
    const head = 130_200_000n;
    /** BNB Smart Chain's pace: a block every 0.45 s. */
    const timeAt = (/** @type {bigint} */ n) =>
      Math.floor(Date.UTC(2026, 9, 28, 0, 0) / 1_000 - Number(head - n) * 0.45);
    /** @param {string} address */
    const topic = (address) =>
      `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
    /** @type {any[]} */
    const searched = [];
    const payout = `0x${"1f".repeat(32)}`;
    // The payout, 10 hours after it was sent, and an hour before it someone
    // else's transfer of the same to the same address.
    const logs = [
      { from: `0x${"5a".repeat(20)}`, hash: `0x${"2e".repeat(32)}`, hours: 3 },
      { from: String(TO_BSC.payoutAddress), hash: payout, hours: 2 },
    ].map(({ from, hash, hours }) => ({
      at: head - BigInt(Math.round((hours * 3_600) / 0.45)),
      from: topic(from),
      hash,
    }));
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

      // As the chain answers: in the window, from the sender asked for.
      return logs
        .filter(
          ({ at, from }) =>
            BigInt(filter.fromBlock) <= at &&
            at <= BigInt(filter.toBlock) &&
            (filter.topics[1] === null || filter.topics[1] === from)
        )
        .map(({ at, hash }) => ({
          blockNumber: `0x${at.toString(16)}`,
          data: `0x${(200_000n * DUSK * 1_000_000_000n).toString(16)}`,
          transactionHash: hash,
        }));
    };
    /** @param {import("../migrationActivity").RouteTransfer} one */
    const arrival = async (one) => {
      /** @type {any} */
      let found = null;

      for (let i = 0; i < 20 && !found; i++) {
        found = await tracking.searchArrival(one, {
          rpc,
          scanFrom: get(activity.transferArrivals)[one.hash]?.scanFrom,
        });
      }

      return found;
    };

    // A check searches a few windows, and keeps where it got to.
    await expect(tracking.searchArrival(transfer, { rpc })).resolves.toBeNull();
    expect(searched[0]).toMatchObject({
      address: TO_BSC.chain.token,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        topic(String(TO_BSC.payoutAddress)),
        topic(EVM),
      ],
    });

    const { scanFrom } = get(activity.transferArrivals)[sent.hash];

    expect(BigInt(scanFrom ?? 0)).toBeGreaterThan(
      BigInt(searched[0].fromBlock)
    );

    // Until it's found, on later checks: the payout, not the other transfer.
    await expect(arrival(transfer)).resolves.toMatchObject({ payout });
    expect(get(activity.transferArrivals)[sent.hash]).toMatchObject({ payout });
    // Another transfer of the same isn't paid with it.
    await expect(
      tracking.searchArrival(
        { ...transfer, hash: "ab".repeat(32) },
        { rpc, scanFrom: searched[0].fromBlock, taken: new Set([payout]) }
      )
    ).resolves.toBeNull();

    // A route whose payout address isn't known takes the first that pays it.
    await expect(
      arrival({
        ...transfer,
        hash: "cd".repeat(32),
        route: { ...TO_BSC, payoutAddress: null },
      })
    ).resolves.toMatchObject({ payout: `0x${"2e".repeat(32)}` });
  });
});
