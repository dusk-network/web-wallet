import { describe, expect, it } from "vitest";

import { depositStageMessage } from "$lib/bridge/depositLifecycle";
import {
  DEPOSIT,
  WITHDRAWAL,
  aboutTime,
  migrationRoute,
  routeTime,
  routeTimeText,
} from "$lib/bridge/routeTimes";

/** What DuskEVM testnet's chains said on 27 Oct 2026. */
const CHAIN = {
  deposit: { at: 1, lagSeconds: 35 },
  withdrawal: {
    at: 1,
    finalitySeconds: 302_400,
    maturitySeconds: 604_800,
    outputSeconds: 1_700,
  },
};

/**
 * @param {RouteTimeRoute} route
 * @param {{ chain?: ChainTimes | null, network?: string }} [timing]
 */
const text = (route, timing) => routeTimeText(routeTime(route, timing));

describe("route times", () => {
  it("reads as an estimate, rounded up on a scale that reads at a glance", () => {
    expect(
      [
        45, 172, 600, 660, 3_400, 3_600, 4_000, 5_400, 5_460, 36_000, 608_200,
      ].map(aboutTime)
    ).toStrictEqual([
      "~1 min",
      "~3 min",
      "~10 min",
      "~15 min",
      "~1 hour",
      "~1 hour",
      "~70 min",
      "~90 min",
      "~2 hours",
      "~10 hours",
      "~7 days",
    ]);
  });

  it("are each network's own, and another network's never stands in", () => {
    // Mainnet: Ethereum's migrations as measured, BSC's as the docs say.
    expect(text(migrationRoute("ethereum"), { network: "mainnet" })).toBe(
      "~70 min"
    );
    expect(text(migrationRoute("bsc"), { network: "mainnet" })).toBe("~1 hour");
    // Testnet: its deposits as configured; its migrations have no time.
    expect(text(DEPOSIT, { network: "testnet" })).toBe("~1 min");
    expect(text(migrationRoute("ethereum"), { network: "testnet" })).toBe("");
    expect(text(migrationRoute("bsc"), { network: "testnet" })).toBe("");
    // DuskEVM on mainnet, and any network not known here: only what its chains say.
    expect(text(DEPOSIT, { network: "mainnet" })).toBe("");
    expect(text(DEPOSIT, { network: "devnet" })).toBe("");
    expect(text(WITHDRAWAL, { network: "testnet" })).toBe("");
  });

  it("take what the chain says over the configured time", () => {
    expect(
      routeTime(DEPOSIT, {
        chain: { deposit: { at: 1, lagSeconds: 290 } },
        network: "testnet",
      })
    ).toStrictEqual({ seconds: 300, source: "chain" });
    expect(text(DEPOSIT, { chain: CHAIN, network: "mainnet" })).toBe("~1 min");
    expect(routeTime(WITHDRAWAL, { chain: CHAIN })).toStrictEqual({
      report: 3_400,
      seconds: 608_200,
      source: "chain",
      wait: 604_800,
    });
    // A dispute game finality delay longer than the proof's maturity is the wait.
    expect(
      routeTime(WITHDRAWAL, {
        chain: {
          withdrawal: { ...CHAIN.withdrawal, finalitySeconds: 1_209_600 },
        },
      })?.wait
    ).toBe(1_209_600);
  });

  it("give a deposit on its way its time, where it's known", () => {
    const deposit = { stage: "l2_pending" };

    expect(
      depositStageMessage(deposit, {
        time: routeTime(DEPOSIT, { network: "testnet" }),
      })
    ).toBe(
      "Finalized on DuskDS. Arrives on DuskEVM in ~1 min. Don't send it again."
    );
    expect(depositStageMessage(deposit)).toBe(
      "Finalized on DuskDS, on its way to DuskEVM. Don't send it again."
    );
  });
});
