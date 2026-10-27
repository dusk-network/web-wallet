import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { fullDateTime, timeLabel } from "$lib/activity/present";

import HistoryView from "../HistoryView.svelte";

const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

// Either side of the clocks going back in Europe.
const SUMMER = Date.UTC(2026, 9, 22, 16, 55);
const WINTER = Date.UTC(2026, 9, 26, 13, 32);

/**
 * @param {string} hash
 * @param {number} timestamp
 * @returns {ActivityRow}
 */
const row = (hash, timestamp) => ({
  amount: "100000000",
  blockHeight: 4_687_000,
  direction: "out",
  hash,
  kind: "transfer",
  privacy: "public",
  source: "archive",
  status: "executed",
  success: true,
  timestamp,
  to: ACCOUNT,
});

const state = {
  complete: true,
  error: null,
  hasMore: false,
  loaded: true,
  rows: [row("a1".repeat(32), WINTER), row("a2".repeat(32), SUMMER)],
  syncing: false,
};

describe("HistoryView", () => {
  afterEach(cleanup);

  it("should say times are local, each with its own offset on hover, and keep them on phones", () => {
    const { container, getByText } = render(HistoryView, {
      locale: "en",
      state,
    });
    const cells = Array.from(
      container.querySelectorAll("td.history__col-time")
    );

    expect(
      getByText(/^Times in your local time\./, { exact: false })
    ).toBeInTheDocument();
    expect(container.querySelector("th.history__col-time")).toHaveTextContent(
      /^Time$/
    );
    expect(cells.map((cell) => cell.getAttribute("title"))).toStrictEqual([
      fullDateTime(WINTER, "en"),
      fullDateTime(SUMMER, "en"),
    ]);
    expect(
      Array.from(container.querySelectorAll(".history__phone-meta"), (meta) =>
        meta.textContent?.replace(/\s+/g, " ").trim()
      )
    ).toStrictEqual([
      `· ${timeLabel(WINTER, "en")} · Public`,
      `· ${timeLabel(SUMMER, "en")} · Public`,
    ]);
  });

  it("should name each row's button with its amount and date", () => {
    const { getAllByRole } = render(HistoryView, { locale: "en", state });
    const [first] = getAllByRole("button", { name: /DUSK/ });

    expect(first).toHaveAccessibleName(
      `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)}, Sent, −0.1 DUSK, ${fullDateTime(WINTER, "en")}, Public`
    );
  });
});
