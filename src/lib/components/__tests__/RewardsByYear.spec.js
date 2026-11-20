import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { REWARD_WORDS } from "@dusk-network/app-core/export";

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

  /** @param {Element | null | undefined} element */
  const textOf = (element) =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

  /**
   * A year's figures in a column, found by the year and by the column's
   * heading: in DUSK, and in money, apart from what stands between them.
   *
   * @param {HTMLElement} container
   * @param {number} year
   * @param {string} column The column's heading
   */
  const figuresOf = (container, year, column) => {
    const headings = Array.from(container.querySelectorAll("thead th"), textOf);
    const row = /** @type {HTMLTableRowElement | undefined} */ (
      Array.from(container.querySelectorAll("tbody tr")).find(
        (each) => textOf(each.querySelector("th")) === String(year),
      )
    );
    const text = textOf(row?.cells[headings.indexOf(column)]);
    const dusk = text.slice(0, text.indexOf(" DUSK") + " DUSK".length);

    return [dusk, text.slice(dusk.length).replace(/^[^a-z0-9−€+-]+/i, "")];
  };

  it("counts what unstaking took out at average cost with the deposit fees, as said under the years, and shows a loss as one, in DUSK and in money", () => {
    const { container } = render(RewardsByYear, {
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

    // Less than a cent either way: under it, a loss said as one.
    expect(figuresOf(container, 2026, REWARD_WORDS.claimed)).toStrictEqual([
      "0 DUSK",
      "€0.00",
    ]);
    expect(figuresOf(container, 2026, REWARD_WORDS.sozuGrown)).toStrictEqual([
      "0.0425 DUSK",
      "€0.01",
    ]);
    expect(figuresOf(container, 2026, REWARD_WORDS.sozu)).toStrictEqual([
      "−0.0035 DUSK",
      "a loss under €0.01",
    ]);
    // More: with its sign.
    expect(figuresOf(container, 2025, REWARD_WORDS.claimed)).toStrictEqual([
      "0 DUSK",
      "€0.00",
    ]);
    expect(figuresOf(container, 2025, REWARD_WORDS.sozuGrown)).toStrictEqual([
      "0.000002 DUSK",
      "under €0.01",
    ]);
    expect(figuresOf(container, 2025, REWARD_WORDS.sozu)).toStrictEqual([
      "−1.5 DUSK",
      "−€0.48",
    ]);
  });

  it("shows a loss in what grew while held as in what unstaking took out, as one cost basis gives both", () => {
    const { container } = render(RewardsByYear, {
      currency: "EUR",
      locale: "en",
      rewards: {
        currency: "EUR",
        shieldedWaiting: false,
        years: [
          // Nandini's: a stake and its unstake at one rate, its fee lost.
          {
            claimed: sum(0n, "0"),
            sozu: sum(-500_000n, "-0.0002"),
            sozuGrown: sum(-500_000n, "-0.0002"),
            reading: 0,
            year: 2026,
          },
        ],
      },
      valued: true,
    });

    expect(figuresOf(container, 2026, REWARD_WORDS.claimed)).toStrictEqual([
      "0 DUSK",
      "€0.00",
    ]);
    expect(figuresOf(container, 2026, REWARD_WORDS.sozuGrown)).toStrictEqual([
      "−0.0005 DUSK",
      "a loss under €0.01",
    ]);
    expect(figuresOf(container, 2026, REWARD_WORDS.sozu)).toStrictEqual([
      "−0.0005 DUSK",
      "a loss under €0.01",
    ]);
  });
});
