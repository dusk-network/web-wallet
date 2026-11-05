import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { networks } from "@dusk-network/networks";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { openRouteStatus, routeStatuses, statusLine } from "../routeStatus";

const { bridgeStatus } = vi.hoisted(() => ({ bridgeStatus: vi.fn() }));

vi.mock("@dusk-network/app-core/bridge", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  bridgeStatus,
}));

const NOW = Date.UTC(2026, 10, 5, 12);
const LUX = 1_000_000_000n;

/** @param {Partial<import("../routeStatus").RouteStatus>} [fields] */
const status = (fields) =>
  /** @type {import("../routeStatus").RouteStatus} */ ({
    canPay: null,
    lastPayout: null,
    limit: "mints",
    paying: "yes",
    readSince: null,
    ...fields,
  });

describe("How a route is doing", () => {
  afterEach(() => {
    bridgeStatus.mockReset();
    setNodeNetwork(null);
  });

  describe("said in a line", () => {
    const at = { locale: "en", now: NOW };
    const paid = {
      lastPayout: { amount: LUX, at: NOW - 12 * 60_000, block: 1, hash: "a" },
    };

    it("says it's paying out, with the last payout, where the chains say", () => {
      expect(statusLine(status(paid), at)).toStrictEqual({
        text: "Paying out. Last payout 12 minutes ago.",
        warn: false,
      });
      expect(statusLine(status(), at)?.text).toBe("Paying out.");
    });

    it("says it's late as something to know, and what it pays on claim as no wait at all", () => {
      expect(statusLine(status({ ...paid, paying: "late" }), at)).toStrictEqual(
        {
          text: "Payouts are running late. Last payout 12 minutes ago.",
          warn: true,
        }
      );
      expect(statusLine(status({ paying: "on-claim" }), at)).toStrictEqual({
        text: "It pays when you claim it.",
        warn: false,
      });
    });

    it("says a quiet route's last payout, or how far it looked", () => {
      expect(statusLine(status({ ...paid, paying: "quiet" }), at)?.text).toBe(
        "Last payout 12 minutes ago."
      );
      expect(
        statusLine(
          status({ paying: "quiet", readSince: Date.UTC(2026, 9, 6, 12) }),
          at
        )?.text
      ).toBe("No payouts since 6 Oct.");
      expect(statusLine(status({ paying: "quiet" }), at)?.text).toBe(
        "No recent payouts."
      );
    });

    it("says unknown as not knowing, never as a problem", () => {
      expect(statusLine(status({ paying: "unknown" }), at)).toStrictEqual({
        text: "Last payout not known right now.",
        warn: false,
      });
    });

    it("says nothing with nothing read, or for a route that isn't running, which its card says", () => {
      expect(statusLine(null, at)).toBeNull();
      expect(statusLine(status({ paying: "stopped" }), at)).toBeNull();
    });

    it("says what it can pay where a balance limits it, and warns of an amount past it", () => {
      const balance = status({ canPay: 5n * LUX, limit: "balance" });

      expect(statusLine(balance, at)?.text).toBe(
        "Paying out. It can pay up to 5 DUSK."
      );
      expect(statusLine(balance, { ...at, amountLux: 5n * LUX })?.warn).toBe(
        false
      );
      expect(statusLine(balance, { ...at, amountLux: 6n * LUX })).toStrictEqual(
        {
          text: "Paying out. It can pay up to 5 DUSK now, less than you're sending, so yours may wait.",
          warn: true,
        }
      );
      // What's minted as it's paid has no such limit.
      expect(
        statusLine(status({ canPay: 5n * LUX }), { ...at, amountLux: 6n * LUX })
          ?.text
      ).toBe("Paying out.");
    });
  });

  describe("read as a card opens", () => {
    const route = { id: "dusk-to-bsc", running: true };

    it("reads a running route once while what it read isn't old, and not one that isn't running", async () => {
      setNodeNetwork(networks.testnet);
      bridgeStatus.mockResolvedValue(status({ paying: "late" }));

      openRouteStatus({ ...route, running: false }, NOW);
      expect(bridgeStatus).not.toHaveBeenCalled();

      openRouteStatus(route, NOW);
      openRouteStatus(route, NOW + 1000);

      await vi.waitFor(() =>
        expect(get(routeStatuses).get(route.id)?.paying).toBe("late")
      );
      expect(bridgeStatus).toHaveBeenCalledOnce();
      expect(bridgeStatus.mock.lastCall?.[0]).toMatchObject({
        route: route.id,
      });

      openRouteStatus(route, NOW + 600_000);

      await vi.waitFor(() => expect(bridgeStatus).toHaveBeenCalledTimes(2));
    });

    it("says it doesn't know when the read fails", async () => {
      setNodeNetwork(networks.testnet);
      bridgeStatus.mockRejectedValue(new TypeError("no such route"));

      const failing = { id: "bsc-to-dusk", running: true };

      openRouteStatus(failing, NOW);

      await vi.waitFor(() =>
        expect(get(routeStatuses).get(failing.id)?.paying).toBe("unknown")
      );
    });
  });
});
