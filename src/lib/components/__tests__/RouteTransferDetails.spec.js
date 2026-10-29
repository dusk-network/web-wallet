import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";

import { cardRoutes } from "$lib/bridge/cardRoutes";

import RouteTransferDetails from "../EvmTransactions/RouteTransferDetails.svelte";

const route = /** @type {import("$lib/bridge/cardRoutes").CardRoute} */ (
  cardRoutes(networks.mainnet).find(({ id }) => id === "bsc-to-dusk")
);
const PAID_AT = Date.UTC(2026, 9, 29, 16, 30);

/**
 * A migration from BNB Smart Chain, paid on Dusk.
 *
 * @param {number | null} at When it was sent, where that's known
 * @returns {import("$lib/bridge/migrationActivity").RouteTransfer}
 */
const migration = (at) => ({
  amountLux: 4_000_000_000n,
  at,
  hash: `0x${"bf".repeat(32)}`,
  kind: "migration",
  paidAt: PAID_AT,
  payout: "5c".repeat(32),
  recipient: "",
  route,
  stage: "paid",
});

/** @param {HTMLElement} container */
const terms = (container) =>
  Array.from(container.querySelectorAll("dt"), (term) => term.textContent);

describe("RouteTransferDetails", () => {
  afterEach(cleanup);

  it("says when a migration known only by its payout was paid, never as when it was sent", () => {
    const { container } = render(RouteTransferDetails, {
      transfer: migration(null),
    });

    expect(terms(container)).toStrictEqual([
      "BNB Smart Chain transaction",
      "Paid",
      "Dusk payout",
    ]);
  });

  it("says when one sent from here was sent, and when it was paid", () => {
    const { container } = render(RouteTransferDetails, {
      transfer: migration(PAID_AT - 60_000),
    });

    expect(terms(container)).toStrictEqual([
      "Sent",
      "BNB Smart Chain transaction",
      "Paid",
      "Dusk payout",
    ]);
  });
});
