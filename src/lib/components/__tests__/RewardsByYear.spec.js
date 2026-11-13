import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { RewardsByYear } from "..";

/**
 * A year's sum, as app-core gives it.
 *
 * @param {bigint} lux
 * @param {string | null} [worth]
 */
const sum = (lux, worth = null) => ({ lux, unpriced: 0, worth });

describe("RewardsByYear", () => {
  afterEach(cleanup);

  /**
   * The row of a year, as read.
   *
   * @param {HTMLElement} container
   * @param {number} year
   */
  const rowOf = (container, year) =>
    Array.from(
      /** @type {HTMLTableRowElement | undefined} */ (
        Array.from(container.querySelectorAll("tbody tr")).find(
          (row) => row.querySelector("th")?.textContent === String(year)
        )
      )?.cells ?? [],
      (cell) => cell.textContent?.replace(/\s+/g, " ").trim()
    );

  it("counts what unstaking took out at average cost with the deposit fees, as said under the years, and shows a loss as one, in DUSK and in money", () => {
    const { container, getByText } = render(RewardsByYear, {
      currency: "EUR",
      locale: "en",
      rewards: {
        currency: "EUR",
        shieldedWaiting: false,
        years: [
          // Lena's 2026: a stake and its unstake at one rate lose their fee.
          {
            claimed: sum(0n, "0"),
            sozu: sum(-3_527_171n, "-0.0011"),
            sozuGrown: sum(42_533_520n, "0.0136"),
            reading: 0,
            year: 2026,
          },
          {
            claimed: sum(0n, "0"),
            sozu: sum(-1_500_000_000n, "-0.48"),
            sozuGrown: sum(2_000n, "0.0000006"),
            reading: 0,
            year: 2025,
          },
        ],
      },
      valued: true,
    });

    expect(
      getByText(
        "Taken out by unstaking is part of grown while held: what came back, less that stDUSK's average cost, deposit fees included."
      )
    ).toBeInTheDocument();

    // Less than a cent either way: under it, a loss said as one.
    expect(rowOf(container, 2026)).toStrictEqual([
      "2026",
      "0 DUSK · €0.00",
      "0.0425 DUSK · €0.01",
      "−0.0035 DUSK · a loss under €0.01",
    ]);
    // More: with its sign.
    expect(rowOf(container, 2025)).toStrictEqual([
      "2025",
      "0 DUSK · €0.00",
      "0.000002 DUSK · under €0.01",
      "−1.5 DUSK · −€0.48",
    ]);
  });
});
