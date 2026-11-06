import { describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";

import { makeExport } from "../accountantExport";
import { rowOf } from "./fixtures/rows";

// What each migration did on its own chain, as its chain says it.
const chain = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<(...args: any[]) => Promise<Map<string, any>>>} */
  read: vi.fn(async () => new Map()),
}));

vi.mock("$lib/bridge/migrationEvm", () => ({ readMigrationsEvm: chain.read }));

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
        euro: false,
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
});
