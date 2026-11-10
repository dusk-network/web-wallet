import { describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";

import { makeExport } from "../accountantExport";
import { rowOf } from "./fixtures/rows";

// What each migration did on its own chain, as its chain says it.
const chain = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<(...args: any[]) => Promise<Map<string, any>>>} */
  read: vi.fn(async () => new Map()),
}));

vi.mock("$lib/bridge/migrationEvm", () => ({
  readMigrationApprovals: async () => [],
  readMigrationsEvm: chain.read,
}));

// The migrations this browser sent: the approval each sent is kept with it.
vi.mock("$lib/bridge/migrationActivity", async () => {
  const { readable } = await import("svelte/store");

  return {
    keptMigrations: readable([
      {
        amountLux: "5000000000",
        approval: `0x${"ab".repeat(32)}`,
        createdAt: Date.UTC(2026, 9, 27, 6, 17),
        hash: `0x${"a6".repeat(32)}`,
        recipient: "",
        routeId: "bsc-to-dusk",
        sender: "0x1111111111111111111111111111111111111111",
      },
    ]),
  };
});

const BSC = /** @type {any} */ (
  networks.mainnet.routes.migrations.find(({ id }) => id === "bsc-to-dusk")
);
const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const MIGRATION = `0x${"a6".repeat(32)}`;
const APPROVAL = `0x${"ab".repeat(32)}`;
const EVM = "0x1111111111111111111111111111111111111111";

describe("History's Export", () => {
  it("writes what a migration and the approval it spent paid in gas on their chain, each with its own hash", async () => {
    // Its payout on Dusk: from the route's account, the migration's hash as
    // the memo.
    const payout = rowOf(
      {
        amount: "5000000000",
        blockHeight: 4_700_000,
        counterparty: BSC.payoutAccount,
        direction: "in",
        hash: "bb".repeat(32),
        memo: MIGRATION,
        status: "executed",
        timestamp: Date.UTC(2026, 9, 27, 7, 26),
      },
      { network: networks.mainnet }
    );

    chain.read.mockResolvedValueOnce(
      new Map([
        [
          MIGRATION,
          {
            approval: {
              at: Date.UTC(2026, 9, 27, 6, 18),
              block: 9,
              gasWei: 46_194_000_739_104n,
              hash: APPROVAL,
            },
            approvalState: "found",
            at: Date.UTC(2026, 9, 27, 6, 20),
            block: 10,
            coin: "BNB",
            from: EVM,
            gasWei: 47_005_000_752_080n,
            hash: MIGRATION,
            lux: 5_000_000_000n,
            route: "bsc-to-dusk",
            state: "mined",
            totalWei: 93_199_001_491_184n,
          },
        ],
      ])
    );

    const { csv } = await makeExport({
      choices: {
        fiat: false,
        excel: false,
        from: "",
        period: "all",
        to: "",
        withContacts: false,
      },
      contactName: () => null,
      net: networks.mainnet,
      network: "mainnet",
      profile: { account: ACCOUNT, name: "Profile 1" },
      profiles: [],
      session: {
        sozuFacts: async () => new Map(),
        whole: async () => ({ rows: [payout], shieldedWaiting: false }),
      },
    });

    // With the approval this browser kept, which the chain's logs may no
    // longer say.
    expect(chain.read).toHaveBeenCalledWith(networks.mainnet, [
      {
        approval: APPROVAL,
        hash: MIGRATION,
        payout: payout.hash,
        route: "bsc-to-dusk",
      },
    ]);
    // Each a cost of its own in BNB, at its own time, before the payout.
    expect(csv.split("\r\n").slice(1, 3)).toStrictEqual([
      `2026-10-27 06:18:00,0.000046194000739104,BNB,,,,,,,cost,Network fee on BNB Smart Chain: approval for a migration to Dusk,${APPROVAL},BNB Smart Chain,${EVM},,${BSC.contract.toLowerCase()},,`,
      `2026-10-27 06:20:00,0.00004700500075208,BNB,,,,,,,cost,Network fee on BNB Smart Chain: migration of 5 BEP20 DUSK to Dusk,${MIGRATION},BNB Smart Chain,${EVM},,${BSC.contract.toLowerCase()},,`,
    ]);
  });

  it("writes a migration's fees in the period of their own day, though its payout comes the day after, outside it", async () => {
    // Approved and migrated on the 27th, at midday; paid out on Dusk on the 28th.
    const payout = rowOf(
      {
        amount: "5000000000",
        blockHeight: 4_710_000,
        counterparty: BSC.payoutAccount,
        direction: "in",
        hash: "bc".repeat(32),
        memo: MIGRATION,
        status: "executed",
        timestamp: Date.UTC(2026, 9, 28, 12),
      },
      { network: networks.mainnet }
    );

    chain.read.mockResolvedValueOnce(
      new Map([
        [
          MIGRATION,
          {
            approval: {
              at: Date.UTC(2026, 9, 27, 11),
              block: 9,
              gasWei: 46_194_000_739_104n,
              hash: APPROVAL,
            },
            approvalState: "found",
            at: Date.UTC(2026, 9, 27, 11, 5),
            block: 10,
            coin: "BNB",
            from: EVM,
            gasWei: 47_005_000_752_080n,
            hash: MIGRATION,
            lux: 5_000_000_000n,
            route: "bsc-to-dusk",
            state: "mined",
            totalWei: 93_199_001_491_184n,
          },
        ],
      ])
    );

    const { csv } = await makeExport({
      choices: {
        fiat: false,
        excel: false,
        from: "2026-10-27",
        period: "dates",
        to: "2026-10-27",
        withContacts: false,
      },
      contactName: () => null,
      net: networks.mainnet,
      network: "mainnet",
      profile: { account: ACCOUNT, name: "Profile 1" },
      profiles: [],
      session: {
        sozuFacts: async () => new Map(),
        whole: async () => ({ rows: [payout], shieldedWaiting: false }),
      },
    });
    const lines = csv.split("\r\n").filter(Boolean);

    // Its payout, after the period, is read for its fees in it.
    expect(chain.read).toHaveBeenLastCalledWith(networks.mainnet, [
      expect.objectContaining({ hash: MIGRATION, payout: payout.hash }),
    ]);
    expect(
      lines.slice(1).map((line) => line.split(",").slice(9, 12))
    ).toStrictEqual([
      [
        "cost",
        "Network fee on BNB Smart Chain: approval for a migration to Dusk",
        APPROVAL,
      ],
      [
        "cost",
        "Network fee on BNB Smart Chain: migration of 5 BEP20 DUSK to Dusk",
        MIGRATION,
      ],
    ]);
  });

  it("writes no gas of a migration from an EVM address not known as the person's, as a customer's to a shop, and writes it once that one's connected", async () => {
    const CUSTOMER = "0x2222222222222222222222222222222222222222";
    const THEIRS = `0x${"c7".repeat(32)}`;
    const payout = rowOf(
      {
        amount: "5000000000",
        blockHeight: 4_700_000,
        counterparty: BSC.payoutAccount,
        direction: "in",
        hash: "bd".repeat(32),
        memo: THEIRS,
        status: "executed",
        timestamp: Date.UTC(2026, 9, 27, 7, 26),
      },
      { network: networks.mainnet }
    );
    const evm = new Map([
      [
        THEIRS,
        {
          approval: null,
          approvalState: "none",
          at: Date.UTC(2026, 9, 27, 6, 20),
          block: 10,
          coin: "BNB",
          from: CUSTOMER,
          gasWei: 47_005_000_752_080n,
          hash: THEIRS,
          lux: 5_000_000_000n,
          route: "bsc-to-dusk",
          state: "mined",
          totalWei: 47_005_000_752_080n,
        },
      ],
    ]);
    /** @param {string[]} [evmConnected] */
    const costs = async (evmConnected) => {
      chain.read.mockResolvedValueOnce(evm);

      const { csv } = await makeExport({
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
        net: networks.mainnet,
        network: "mainnet",
        profile: { account: ACCOUNT, name: "Profile 1" },
        profiles: [],
        session: {
          sozuFacts: async () => new Map(),
          whole: async () => ({ rows: [payout], shieldedWaiting: false }),
        },
      });

      return csv.split("\r\n").filter((line) => line.includes(",cost,"));
    };

    expect(await costs()).toStrictEqual([]);
    expect(await costs([CUSTOMER.toUpperCase().replace("0X", "0x")])).toEqual([
      expect.stringContaining(
        `,cost,Network fee on BNB Smart Chain: migration of 5 BEP20 DUSK to Dusk,${THEIRS},`
      ),
    ]);
  });
});
