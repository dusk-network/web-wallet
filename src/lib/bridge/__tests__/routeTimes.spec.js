import { describe, expect, it } from "vitest";
import { networks, routes } from "@dusk-network/networks";

import { depositStageMessage } from "$lib/bridge/depositLifecycle";
import {
  DEPOSIT,
  WITHDRAWAL,
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
 * @param {RouteTimeRoute | import("@dusk-network/networks").Route} route
 * @param {{ chain?: ChainTimes | null, net?: import("@dusk-network/networks").Network | null }} [timing]
 */
const text = (route, timing) => routeTimeText(routeTime(route, timing));

describe("route times", () => {
  it("are each network's own, as its file says, and another network's never stands in", () => {
    const { mainnet, testnet } = networks;

    // Mainnet: its migrations' and its transfer to BNB Smart Chain's.
    expect(text(migrationRoute("ethereum"), { net: mainnet })).toBe("~70 min");
    expect(text(migrationRoute("bsc"), { net: mainnet })).toBe("~1 hour");
    expect(
      routes(mainnet).map((route) => [route.id, text(route, { net: mainnet })])
    ).toStrictEqual([
      ["bsc-to-dusk", "~1 hour"],
      ["ethereum-to-dusk", "~70 min"],
      ["dusk-to-bsc", "~10 hours"],
    ]);
    // Testnet: its deposits'; its migrations have no time.
    expect(text(DEPOSIT, { net: testnet })).toBe("~1 min");
    expect(text(migrationRoute("ethereum"), { net: testnet })).toBe("");
    expect(text(migrationRoute("bsc"), { net: testnet })).toBe("");
    // DuskEVM on mainnet, and a network without a file: only what its chains say.
    expect(text(DEPOSIT, { net: mainnet })).toBe("");
    expect(text(DEPOSIT, { net: null })).toBe("");
    expect(text(WITHDRAWAL, { net: testnet })).toBe("");
  });

  it("take what the chain says over the configured time", () => {
    expect(
      routeTime(DEPOSIT, {
        chain: { deposit: { at: 1, lagSeconds: 290 } },
        net: networks.testnet,
      })
    ).toStrictEqual({ seconds: 300, source: "chain" });
    expect(text(DEPOSIT, { chain: CHAIN, net: networks.mainnet })).toBe(
      "~1 min"
    );
    // The Portal's wait after a proof, and about when it can be proved: an
    // output after it's sent, for "Claim 7 days after you prove. You can
    // prove about 30 minutes after sending."
    expect(routeTime(WITHDRAWAL, { chain: CHAIN })).toStrictEqual({
      maturity: 604_800,
      prove: 1_700,
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
        time: routeTime(DEPOSIT, { net: networks.testnet }),
      })
    ).toBe(
      "Finalized on DuskDS. Arrives on DuskEVM in ~1 min. Don't send it again."
    );
    expect(depositStageMessage(deposit)).toBe(
      "Finalized on DuskDS, on its way to DuskEVM. Don't send it again."
    );
  });
});
