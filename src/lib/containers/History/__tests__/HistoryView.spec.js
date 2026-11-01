import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { fullDateTime, timeLabel } from "$lib/activity/present";
import styleRules from "$lib/dusk/test-helpers/styleRules";

import HistoryView from "../HistoryView.svelte";

vi.mock("$lib/bridge/withdrawalClaims", () => {
  // When the chain says the proved withdrawal can be claimed: Mon 2 Nov 2026, 03:20:39 UTC.
  const claims = new Map([
    [
      `0x${"8e".repeat(32)}`,
      {
        at: Date.UTC(2026, 10, 2, 3, 20, 39),
        claimed: false,
        exact: false,
        overdue: false,
        ready: false,
      },
    ],
  ]);

  return {
    default: {
      load: () => Promise.resolve(),
      /** @param {(value: Map<string, unknown>) => void} run */
      subscribe(run) {
        run(claims);

        return () => {};
      },
    },
  };
});

const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

// Either side of the clocks going back in Europe.
const SUMMER = Date.UTC(2026, 9, 22, 16, 55);
const WINTER = Date.UTC(2026, 9, 26, 13, 32);

/**
 * A transfer sent, final, and more about it.
 *
 * @param {string} hash
 * @param {number} timestamp
 * @param {Record<string, unknown>} [more]
 */
const row = (hash, timestamp, more = {}) =>
  rowOf({
    amount: "100000000",
    blockHeight: 4_687_000,
    hash,
    status: "executed",
    timestamp,
    to: ACCOUNT,
    ...more,
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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
        rows: [row("a1".repeat(32), WINTER, { success: null })],
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
    const proved = row("b1".repeat(32), WINTER, {
      amount: "0",
      bridge: {
        amount: "1008000000000",
        kind: "prove",
        withdrawal: "0001".padEnd(64, "0"),
      },
      contractId: "ab".repeat(32),
      fnName: "proveWithdrawalTransaction",
      kind: "contract_call",
      to: undefined,
    });
    const { container } = render(HistoryView, {
      locale: "en",
      state: { ...state, rows: [proved, state.rows[0]] },
    });
    const amounts = Array.from(
      container.querySelectorAll(".history__amount"),
      (amount) => amount.classList.contains("history__amount--muted")
    );

    expect(amounts).toStrictEqual([true, false]);
  });

  it("should give a withdrawal's claim date a line of its own on phones, as it doesn't fit after", () => {
    // The claim date stays ahead of today, whenever the test runs.
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 31, 12), toFake: ["Date"] });

    const proved = row("b1".repeat(32), WINTER, {
      amount: "0",
      bridge: {
        amount: "1008000000000",
        hash: `0x${"8e".repeat(32)}`,
        kind: "prove",
        withdrawal: "0001".padEnd(64, "0"),
      },
      contractId: "ab".repeat(32),
      fnName: "proveWithdrawalTransaction",
      kind: "contract_call",
      to: undefined,
    });

    const { container } = render(HistoryView, {
      locale: "en",
      state: { ...state, rows: [proved, state.rows[0]] },
    });
    const [withdrawal, sent] = Array.from(
      container.querySelectorAll(".history__who"),
      (who) => ({
        narrow: who.querySelector(".history__narrow")?.textContent,
        note: who.querySelector(".history__claim")?.textContent?.trim(),
        wide: who.querySelector(".history__wide")?.textContent,
      })
    );

    // A desktop's line keeps the date; a phone's has it under the line.
    expect(withdrawal.wide).toMatch(/^Bridge · claim from about 2 Nov, /);
    expect(withdrawal.narrow).toBe("Bridge");
    expect(withdrawal.note).toMatch(/^Claim from about 2 Nov, /);
    expect(sent).toStrictEqual({
      narrow: undefined,
      note: undefined,
      wide: undefined,
    });

    // On phones only, and nothing else of the page hidden with it, as the
    // note above the table.
    const rules = styleRules("../HistoryView.svelte", import.meta.url);
    const phone = "(max-width: 47.99rem)";
    const ruleOf = (/** @type {string} */ selector, media = "") =>
      rules.find(
        (rule) =>
          rule.media === media &&
          rule.selector.split(",").some((part) => part.trim() === selector)
      );

    expect(ruleOf(".history__claim")?.declarations.display).toBe("none");
    expect(ruleOf(".history__claim", phone)?.declarations.display).toBe(
      "block"
    );
    expect(ruleOf(".history__wide", phone)?.declarations.display).toBe("none");
    expect(
      rules.filter(
        (rule) =>
          rule.selector.includes(".history__note") &&
          (rule.declarations.display === "none" ||
            rule.declarations["white-space"] === "nowrap")
      )
    ).toStrictEqual([]);
  });
  it("should give a deposit's time a line of its own on phones, as its DuskEVM address makes its line long", () => {
    const deposited = row("d1".repeat(32), WINTER, {
      bridge: {
        amount: "100000000",
        kind: "deposit",
        to: "0xB0E834d62CA3f5cF0F82619c8515c673818f8C6b",
      },
      contractId: "ab".repeat(32),
      fnName: "depositETHToWithValue",
      kind: "contract_call",
      to: undefined,
    });

    const { container } = render(HistoryView, {
      locale: "en",
      state: { ...state, rows: [deposited, state.rows[0]] },
    });
    const [deposit, sent] = Array.from(
      container.querySelectorAll(".history__who"),
      (who) => ({
        line: who.querySelector(".history__line")?.textContent?.trim(),
        meta: who.querySelector(".history__phone-meta"),
        when: who.querySelector(".history__when")?.textContent?.trim(),
      })
    );

    expect(deposit.line).toBe("Bridge · to 0xb0E8…8C6b");
    expect(deposit.meta).toBeNull();
    expect(deposit.when).toBe(`${timeLabel(WINTER, "en")} · Public`);
    // Any other row keeps its time after its line.
    expect(sent.when).toBeUndefined();
    expect(sent.meta).not.toBeNull();

    const rules = styleRules("../HistoryView.svelte", import.meta.url);
    const ruleOf = (/** @type {string} */ selector, media = "") =>
      rules.find(
        (rule) =>
          rule.media === media &&
          rule.selector.split(",").some((part) => part.trim() === selector)
      );

    expect(ruleOf(".history__when")?.declarations.display).toBe("none");
    expect(
      ruleOf(".history__when", "(max-width: 47.99rem)")?.declarations.display
    ).toBe("block");
  });
});
