import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { fullDateTime, shortAddress, timeLabel } from "$lib/activity/present";
import styleRules from "$lib/dusk/test-helpers/styleRules";
import { settingsStore } from "$lib/stores";

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

/** The profile's whole history, as Export reads it. */
const history = vi.hoisted(() => ({ whole: vi.fn() }));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      ...original.walletStore,
      startHistory: () => ({
        sozuFacts: async () => new Map(),
        whole: history.whole,
      }),
    },
  };
});

/** What runs as a navigation ends. */
const navigation = vi.hoisted(() => ({
  /** @type {Array<() => void>} */
  after: [],
}));

vi.mock("$app/navigation", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  afterNavigate: (/** @type {() => void} */ run) => navigation.after.push(run),
}));

describe("HistoryView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("should say times are local, each with its own offset on hover, to the second, and keep them on phones", () => {
    const { container, getByText } = render(HistoryView, {
      locale: "en",
      state,
    });
    const cells = Array.from(
      container.querySelectorAll("td.history__col-time"),
    );

    // Said once: "time" not twice.
    expect(
      getByText(/^Shown in your local time\./, { exact: false }),
    ).toBeInTheDocument();
    expect(container.querySelector("th.history__col-time")).toHaveTextContent(
      /^Time$/,
    );
    // To the second on hover: two in the same minute read apart.
    expect(cells.map((cell) => cell.getAttribute("title"))).toStrictEqual([
      fullDateTime(WINTER, "en", { seconds: true }),
      fullDateTime(SUMMER, "en", { seconds: true }),
    ]);
    expect(cells[0].getAttribute("title")).toMatch(/ \d{1,2}:\d{2}:\d{2} /);
    expect(
      Array.from(container.querySelectorAll(".history__phone-meta"), (meta) =>
        meta.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toStrictEqual([
      `· ${timeLabel(WINTER, "en")} · Public`,
      `· ${timeLabel(SUMMER, "en")} · Public`,
    ]);
  });

  it("should leave a row's amount out of its name while balances are hidden", () => {
    const names = (/** @type {HTMLElement} */ container) =>
      Array.from(container.querySelectorAll(".history__open"), (open) =>
        open.getAttribute("aria-label"),
      );
    const shown = render(HistoryView, { locale: "en", state });

    expect(names(shown.container)[0]).toContain("0.1 DUSK");
    shown.unmount();

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = render(HistoryView, { locale: "en", state });

      expect(names(container).length).toBeGreaterThan(0);

      for (const name of names(container)) {
        expect(name).toContain("amount hidden");
        expect(name).not.toMatch(/\d DUSK/);
      }
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should show staking rewards by year for the profile shown only: none of the one before once another is, nor any read for it that comes after", async () => {
    const other = { address: "other-account", label: "Profile 2" };
    const own = { address: ACCOUNT, label: "Profile 1" };
    const whole = {
      rows: [
        row("c1".repeat(32), WINTER, {
          amount: "2000000000",
          direction: "in",
          kind: "withdraw_reward",
        }),
      ],
      shieldedWaiting: false,
    };
    const { container, getByRole, rerender } = render(HistoryView, {
      account: own,
      locale: "en",
      state,
    });
    const years = () => container.querySelector(".rewards-by-year");

    history.whole.mockResolvedValue(whole);
    await fireEvent.click(getByRole("button", { name: "Export" }));
    await fireEvent.click(
      getByRole("button", { name: "Show staking rewards by year" }),
    );
    await vi.waitFor(() => expect(years()).toHaveTextContent("2 DUSK"));

    await rerender({ account: other });

    expect(years()).toBeNull();

    // Asked for Profile 2, then Profile 1 is shown before it's read.
    /** @type {PromiseWithResolvers<typeof whole>} */
    const late = Promise.withResolvers();

    history.whole.mockReturnValueOnce(late.promise);
    await fireEvent.click(
      getByRole("button", { name: "Show staking rewards by year" }),
    );
    await rerender({ account: own });
    late.resolve(whole);
    await vi.waitFor(() =>
      expect(
        getByRole("button", { name: "Show staking rewards by year" }),
      ).toBeEnabled(),
    );

    expect(years()).toBeNull();
    history.whole.mockReset();
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

    // Going back through the browser's history takes the focus away, as the
    // sheet's step goes: it comes back as that ends.
    first.blur();
    navigation.after.forEach((run) => run());

    expect(first).toHaveFocus();
  });

  // Lena's and Chen's: after Don't send, a payment that went out anyway
  // was "Sent after all" for a few seconds, then an ordinary Sent row.
  it("should say a send that went out after Don't send was one, with when it landed, in its row and its details, until they're opened once", async () => {
    const { markSentAfterDontSend, sentAfterDontSend } =
      await import("$lib/transactions/sentAfterDontSend");
    const { get } = await import("svelte/store");
    const [declined, other] = state.rows;
    const rowText = () =>
      /** @type {HTMLElement} */ (
        container.querySelector(".history__open")
      ).textContent?.replace(/\s+/g, " ");

    markSentAfterDontSend(declined.hash, WINTER);

    const { container, getByText, rerender } = render(HistoryView, {
      locale: "en",
      state,
    });

    expect(rowText()).toContain("Sent after you chose not to send");
    expect(
      container.querySelectorAll(".history__open")[1].textContent,
    ).not.toContain("chose not to send");

    await rerender({ selected: declined.hash });

    expect(
      getByText(
        `Sent after you chose not to send, at ${timeLabel(WINTER, "en", { seconds: true })}`,
      ),
    ).toBeInTheDocument();
    expect(get(sentAfterDontSend)).toStrictEqual({});

    // Opened once: an ordinary send from now on.
    await rerender({ selected: null });

    expect(rowText()).not.toContain("chose not to send");
    expect(other.hash).not.toBe(declined.hash);
  });

  // Codex's, round 40: a payment between two profiles here has one hash in
  // both histories, and the profile it paid said it was sent after Don't
  // send, and took the sender's warning as it was opened.
  it("should say a send went out after Don't send in the sender's row alone, and leave the warning to it as the row of the profile it paid opens", async () => {
    const { markSentAfterDontSend, seenSentAfterDontSend, sentAfterDontSend } =
      await import("$lib/transactions/sentAfterDontSend");
    const { get } = await import("svelte/store");
    const hash = "c3".repeat(32);
    const received = row(hash, WINTER, { direction: "in", from: ACCOUNT });

    markSentAfterDontSend(hash, WINTER);

    try {
      const { container, queryByText, rerender } = render(HistoryView, {
        locale: "en",
        state: { ...state, rows: [received] },
      });

      expect(
        container.querySelector(".history__open")?.textContent,
      ).not.toContain("chose not to send");

      await rerender({ selected: hash });

      expect(queryByText(/chose not to send/)).toBeNull();
      expect(get(sentAfterDontSend)).toStrictEqual({ [hash]: WINTER });
    } finally {
      seenSentAfterDontSend(hash);
    }
  });

  // Codex's, round 40: its details showed as its block was said, a moment
  // before the warning was; they said Completed, and it stayed unread.
  it("should say a send went out after Don't send in its details once that's said while they show, and from then on in its row no more", async () => {
    const { markSentAfterDontSend, seenSentAfterDontSend, sentAfterDontSend } =
      await import("$lib/transactions/sentAfterDontSend");
    const { get } = await import("svelte/store");
    const [declined] = state.rows;
    const { container, findByText, rerender } = render(HistoryView, {
      locale: "en",
      selected: declined.hash,
      state,
    });

    markSentAfterDontSend(declined.hash, WINTER);

    try {
      expect(
        await findByText(
          `Sent after you chose not to send, at ${timeLabel(WINTER, "en", { seconds: true })}`,
        ),
      ).toBeInTheDocument();
      expect(get(sentAfterDontSend)).toStrictEqual({});

      await rerender({ selected: null });

      expect(
        container.querySelector(".history__open")?.textContent,
      ).not.toContain("chose not to send");
    } finally {
      seenSentAfterDontSend(declined.hash);
    }
  });

  it("should say when rows aren't looked up yet", () => {
    const { getByRole } = render(HistoryView, {
      locale: "en",
      state: {
        ...state,
        error: "Couldn't reach",
        rows: [row("a1".repeat(32), WINTER, { success: null })],
      },
    });

    expect(getByRole("status")).toHaveTextContent(
      "Couldn't reach the network's history. A row has no date or fee yet.",
    );
  });

  it("should name each row's button with its amount and date, to the second", () => {
    const { getAllByRole } = render(HistoryView, { locale: "en", state });
    const [first] = getAllByRole("button", { name: /DUSK/ });

    expect(first).toHaveAccessibleName(
      `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)}, Sent, −0.1 DUSK, ${fullDateTime(WINTER, "en", { seconds: true })}, Public`,
    );
  });

  // Amélie's: a search found payments only once Show more had shown them.
  it("should find what a search's See all found in all the history this device keeps, not only the rows shown", () => {
    const shown = row("a1".repeat(32), WINTER, { memo: "Les tulipes du 14" });
    const older = [
      row("a2".repeat(32), WINTER - 9 * 86_400_000, {
        memo: "Les fleurs du marché",
      }),
      row("a3".repeat(32), WINTER - 10 * 86_400_000, {
        memo: "Pour le marché, merci",
      }),
    ];
    const { container, getByRole } = render(HistoryView, {
      locale: "en",
      query: "marché",
      searched: [shown, ...older],
      state: { ...state, rows: [shown] },
    });

    expect(getByRole("status")).toHaveTextContent(
      "2 transactions found for “marché”",
    );
    expect(
      Array.from(container.querySelectorAll(".history__memo"), (memo) =>
        memo.textContent?.trim(),
      ),
    ).toStrictEqual(["Les fleurs du marché", "Pour le marché, merci"]);
  });

  it("should show what a search's See all found, each row's memo, and all of it again from Clear search", async () => {
    const filter = vi.fn();
    const invoices = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      row(`b${n}`.repeat(32), WINTER - n * 60_000, {
        memo: `Factura 2026-05${n}`,
      }),
    );
    const { container, getByRole, getByText, queryByText } = render(
      HistoryView,
      {
        events: { filter },
        props: {
          locale: "en",
          query: "Factura 2026-05",
          state: {
            ...state,
            rows: [
              ...state.rows,
              ...invoices,
              row("c1".repeat(32), WINTER, { memo: "Rent \u202Eyluj" }),
            ],
          },
        },
      },
    );

    // Every one found, not five, each with its memo.
    expect(getByRole("status")).toHaveTextContent(
      "7 transactions found for “Factura 2026-05”",
    );
    expect(
      Array.from(container.querySelectorAll(".history__memo"), (memo) =>
        memo.textContent?.trim(),
      ),
    ).toStrictEqual(invoices.map((_, i) => `Factura 2026-05${i + 1}`));
    expect(queryByText(/Rent/)).toBeNull();

    await fireEvent.click(getByRole("button", { name: "Clear search" }));

    expect(filter).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { q: "" } }),
    );
    cleanup();

    // Unfiltered, a memo's hidden characters show as codes.
    render(HistoryView, {
      locale: "en",
      state: {
        ...state,
        rows: [row("c1".repeat(32), WINTER, { memo: "Rent \u202Eyluj" })],
      },
    });

    expect(getByText("Rent \\u202eyluj")).toBeInTheDocument();
  });

  // Then Lena's and Amélie's: "From sofiadesign.dusk" said nothing of her
  // not being a contact, and a long memo cut off whom it was from.
  it("should show a memo that came in from an address not in the contacts as the sender's words, muted and in quotes, after whom it's from and that they're not in your contacts, a .dusk name or not, and find it all the same", async () => {
    const { saveContact, removeContact } = await import("$lib/contacts");
    const { openTestContacts } = await import("$lib/test-helpers");
    const STRANGER =
      "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";
    const SOFIA =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";

    await openTestContacts();

    // Lucas, a contact, who sent one too.
    const lucas = saveContact({ address: ACCOUNT, name: "Lucas" });
    /**
     * A payment that came in, with its memo.
     *
     * @param {string} hash
     * @param {string} from
     * @param {string} memo
     * @param {string} [counterpartyName]
     */
    const received = (hash, from, memo, counterpartyName) =>
      rowOf({
        amount: "100000000",
        blockHeight: 4_687_000,
        counterpartyName,
        direction: "in",
        from,
        hash,
        memo,
        status: "executed",
        timestamp: WINTER,
      });

    try {
      const { container, rerender } = render(HistoryView, {
        locale: "en",
        query: "",
        state: {
          ...state,
          rows: [
            received(
              "f1".repeat(32),
              STRANGER,
              "URGENT: wallet suspended - pay now to restore",
            ),
            received("f2".repeat(32), SOFIA, "Factura 71", "sofiadesign.dusk"),
            received("f3".repeat(32), ACCOUNT, "Dinner"),
          ],
        },
      });
      const memos = () =>
        Array.from(container.querySelectorAll(".history__memo"), (memo) => [
          memo.textContent?.replace(/\s+/g, " ").trim(),
          memo.classList.contains("history__memo--theirs"),
        ]);

      const urgent = `From ${shortAddress(STRANGER)} · not in your contacts“URGENT: wallet suspended - pay now to restore”`;

      expect(memos()).toStrictEqual([
        [urgent, true],
        ["From sofiadesign.dusk · not in your contacts“Factura 71”", true],
        // A contact's: their memo, as the wallet's are.
        ["Dinner", false],
      ]);
      // Whom it's from first, on its own line: a long memo can't cut it off.
      expect(
        Array.from(
          container.querySelectorAll(".history__memo-from"),
          (from) => from.textContent,
        ),
      ).toStrictEqual([
        `From ${shortAddress(STRANGER)} · not in your contacts`,
        "From sofiadesign.dusk · not in your contacts",
      ]);

      // Found by its words, as any memo is.
      await rerender({ query: "wallet suspended" });

      expect(memos()).toStrictEqual([[urgent, true]]);

      // In its details too.
      await rerender({ query: "", selected: "f1".repeat(32) });

      expect(container.querySelector(".tx-detail__memo")).toHaveTextContent(
        `From ${shortAddress(STRANGER)} · not in your contacts “URGENT: wallet suspended - pay now to restore”`,
      );
    } finally {
      removeContact(lucas.id);
    }
  });

  it("should look further back on Show more in a search until it finds more, and say once there's no more to find", async () => {
    const kopi = (/** @type {number} */ n) =>
      row(`d${n}`.repeat(32), WINTER - n * 3_600_000, { memo: `Kopi ${n}` });
    const other = (/** @type {number} */ n) =>
      row(`e${n}`.repeat(32), WINTER - n * 3_600_000, { memo: "Rent" });
    // The pages Show more reads, older each time: the second has another.
    const pages = [[other(2)], [other(3), kopi(4)], [other(5)], [other(6)]];
    /** @type {any} */
    let shown = { ...state, hasMore: true, rows: [kopi(1)] };
    const onMore = vi.fn(async () => {
      const page = pages.shift() ?? [];

      shown = {
        ...shown,
        hasMore: pages.length > 0,
        rows: [...shown.rows, ...page],
      };
      await rendered.rerender({
        locale: "en",
        onMore,
        query: "kopi",
        state: shown,
      });
    });
    const rendered = render(HistoryView, {
      locale: "en",
      onMore,
      query: "kopi",
      state: shown,
    });
    const memos = () =>
      Array.from(
        rendered.container.querySelectorAll(".history__memo"),
        (memo) => memo.textContent?.trim(),
      );

    expect(memos()).toStrictEqual(["Kopi 1"]);

    // A page of none found adds nothing: it reads on, to the next with one.
    await fireEvent.click(rendered.getByRole("button", { name: "Show more" }));
    await vi.waitFor(() => expect(memos()).toStrictEqual(["Kopi 1", "Kopi 4"]));

    expect(onMore).toHaveBeenCalledTimes(2);

    // None further back: it says so, at the history's end.
    await fireEvent.click(rendered.getByRole("button", { name: "Show more" }));
    await vi.waitFor(() =>
      expect(rendered.getByText("Nothing more found.")).toBeInTheDocument(),
    );

    expect(onMore).toHaveBeenCalledTimes(4);
    expect(rendered.queryByRole("button", { name: "Show more" })).toBeNull();
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
      (amount) => amount.classList.contains("history__amount--muted"),
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
      }),
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
          rule.selector.split(",").some((part) => part.trim() === selector),
      );

    expect(ruleOf(".history__claim")?.declarations.display).toBe("none");
    expect(ruleOf(".history__claim", phone)?.declarations.display).toBe(
      "block",
    );
    expect(ruleOf(".history__wide", phone)?.declarations.display).toBe("none");
    expect(
      rules.filter(
        (rule) =>
          rule.selector.includes(".history__note") &&
          (rule.declarations.display === "none" ||
            rule.declarations["white-space"] === "nowrap"),
      ),
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
      }),
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
          rule.selector.split(",").some((part) => part.trim() === selector),
      );

    expect(ruleOf(".history__when")?.declarations.display).toBe("none");
    expect(
      ruleOf(".history__when", "(max-width: 47.99rem)")?.declarations.display,
    ).toBe("block");
  });
});
