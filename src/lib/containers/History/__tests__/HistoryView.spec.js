import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

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

    // Said once: "time" not twice.
    expect(
      getByText(/^Shown in your local time\./, { exact: false })
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

  it("should close the details on Escape, and give the focus back to their row", async () => {
    const select = vi.fn();
    const { container, getByRole, rerender } = render(HistoryView, {
      locale: "en",
      state,
    });
    const first = /** @type {HTMLButtonElement} */ (
      container.querySelector(".history__open")
    );

    // The page selects what the row dispatches.
    await rerender({ selected: state.rows[0].hash });

    const close = getByRole("button", { name: "Close the details" });

    expect(close).toHaveFocus();

    container.addEventListener("select", select);
    await fireEvent.keyDown(close, { key: "Escape" });

    expect(first).toHaveFocus();
  });

  it("should say when rows aren't looked up yet, and that an export marks them", () => {
    const { getByRole } = render(HistoryView, {
      locale: "en",
      state: {
        ...state,
        error: "Couldn't reach",
        rows: [{ ...state.rows[0], status: "unknown", success: null }],
      },
    });

    expect(getByRole("status")).toHaveTextContent(
      "Couldn't reach the network's history. A row has no date or fee yet. An export marks it \"Not looked up yet\"."
    );
    expect(
      getByRole("checkbox", { name: /Include my contact names/ })
    ).not.toBeChecked();
  });

  it("should name each row's button with its amount and date", () => {
    const { getAllByRole } = render(HistoryView, { locale: "en", state });
    const [first] = getAllByRole("button", { name: /DUSK/ });

    expect(first).toHaveAccessibleName(
      `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)}, Sent, −0.1 DUSK, ${fullDateTime(WINTER, "en")}, Public`
    );
  });

  it("should grey a withdrawal's amount until it arrives, as a failed one's", () => {
    const bridge = "ab".repeat(32);
    const proved = {
      ...row("b1".repeat(32), WINTER),
      amount: "0",
      bridge: /** @type {const} */ ({
        amount: "1008000000000",
        kind: "prove",
        withdrawal: "0001".padEnd(64, "0"),
      }),
      contractId: bridge,
      fnName: "proveWithdrawalTransaction",
      kind: /** @type {const} */ ("contract_call"),
      to: undefined,
    };

    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", bridge);

    try {
      const { container } = render(HistoryView, {
        locale: "en",
        state: { ...state, rows: [proved, state.rows[0]] },
      });
      const amounts = Array.from(
        container.querySelectorAll(".history__amount"),
        (amount) => amount.classList.contains("history__amount--muted")
      );

      expect(amounts).toStrictEqual([true, false]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
