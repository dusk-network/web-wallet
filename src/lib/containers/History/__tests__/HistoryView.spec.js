import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import {
  SENT_AFTER_DONT_SEND,
  shortAddress,
  timeLabel,
} from "$lib/activity/present";
import { settingsStore } from "$lib/stores";

import HistoryView from "../HistoryView.svelte";

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

/**
 * A figure on its own, never part of a longer one: "0.1 DUSK" never as part
 * of "10.1 DUSK", "1:32:00" never of "11:32:00".
 *
 * @param {string} text
 */
const figure = (text) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d])`);
};

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

describe("HistoryView", () => {
  afterEach(() => {
    cleanup();
  });

  it("should leave a row's amount out of its name while balances are hidden", () => {
    const names = (/** @type {HTMLElement} */ container) =>
      Array.from(container.querySelectorAll(".history__open"), (open) =>
        open.getAttribute("aria-label"),
      );
    const shown = render(HistoryView, { locale: "en", state });

    expect(names(shown.container)[0]).toMatch(figure("−0.1 DUSK"));
    shown.unmount();

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = render(HistoryView, { locale: "en", state });

      expect(names(container).length).toBeGreaterThan(0);

      for (const name of names(container)) {
        expect(name).not.toMatch(/\d DUSK/);
      }
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should leave a failed transaction's fee out of its row and its name while balances are hidden, as its details do", () => {
    const failed = {
      ...state,
      rows: [
        row("a3".repeat(32), WINTER, { feePaid: "3700000", status: "failed" }),
      ],
    };
    const shownOf = (/** @type {HTMLElement} */ container) => ({
      line: container.querySelector(".history__line")?.textContent ?? "",
      name:
        container.querySelector(".history__open")?.getAttribute("aria-label") ??
        "",
    });
    const shown = render(HistoryView, { locale: "en", state: failed });

    // What it paid, with balances shown.
    expect(shownOf(shown.container).name).toMatch(figure("0.0037 DUSK"));
    shown.unmount();

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { line, name } = shownOf(
        render(HistoryView, { locale: "en", state: failed }).container,
      );

      expect(line).toMatch(/\bfee\b/);
      expect(line).not.toMatch(/\d DUSK/);
      expect(name).toMatch(/\bfee\b/);
      expect(name).not.toMatch(/\d DUSK/);
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
    /** What native staking claimed in a year, as its row says. */
    const claimedIn = (/** @type {number} */ year) =>
      Array.from(
        container.querySelectorAll(".rewards-by-year tbody tr"),
        (line) => /** @type {HTMLTableRowElement} */ (line).cells,
      )
        .find((cells) => cells[0].textContent?.trim() === String(year))?.[1]
        ?.textContent?.trim();

    history.whole.mockResolvedValue(whole);
    await fireEvent.click(getByRole("button", { name: "Export" }));
    await fireEvent.click(
      getByRole("button", { name: "Staking rewards by year" }),
    );
    await vi.waitFor(() => expect(claimedIn(2026)).toBe("2 DUSK"));

    await rerender({ account: other });

    expect(years()).toBeNull();

    // Asked for Profile 2, then Profile 1 is shown before it's read.
    /** @type {PromiseWithResolvers<typeof whole>} */
    const late = Promise.withResolvers();

    history.whole.mockReturnValueOnce(late.promise);
    await fireEvent.click(
      getByRole("button", { name: "Staking rewards by year" }),
    );
    await rerender({ account: own });
    late.resolve(whole);
    await vi.waitFor(() =>
      expect(
        getByRole("button", { name: "Staking rewards by year" }),
      ).toBeEnabled(),
    );

    expect(years()).toBeNull();
    history.whole.mockReset();
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

    const { container, rerender } = render(HistoryView, {
      locale: "en",
      state,
    });

    expect(rowText()).toContain(SENT_AFTER_DONT_SEND);
    expect(
      container.querySelectorAll(".history__open")[1].textContent,
    ).not.toContain(SENT_AFTER_DONT_SEND);

    await rerender({ selected: declined.hash });

    const outcome = container.querySelector(".tx-detail__outcome");

    expect(outcome).toHaveTextContent(SENT_AFTER_DONT_SEND);
    expect(outcome).toHaveTextContent(
      figure(timeLabel(WINTER, "en", { seconds: true })),
    );
    expect(get(sentAfterDontSend)).toStrictEqual({});

    // Opened once: an ordinary send from now on.
    await rerender({ selected: null });

    expect(rowText()).not.toContain(SENT_AFTER_DONT_SEND);
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
      const { container, rerender } = render(HistoryView, {
        locale: "en",
        state: { ...state, rows: [received] },
      });

      expect(
        container.querySelector(".history__open")?.textContent,
      ).not.toContain(SENT_AFTER_DONT_SEND);

      await rerender({ selected: hash });

      expect(document.body).not.toHaveTextContent(SENT_AFTER_DONT_SEND);
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
    const { container, rerender } = render(HistoryView, {
      locale: "en",
      selected: declined.hash,
      state,
    });
    const outcome = () => container.querySelector(".tx-detail__outcome");

    markSentAfterDontSend(declined.hash, WINTER);

    try {
      await vi.waitFor(() =>
        expect(outcome()).toHaveTextContent(SENT_AFTER_DONT_SEND),
      );
      expect(outcome()).toHaveTextContent(
        figure(timeLabel(WINTER, "en", { seconds: true })),
      );
      expect(get(sentAfterDontSend)).toStrictEqual({});

      await rerender({ selected: null });

      expect(
        container.querySelector(".history__open")?.textContent,
      ).not.toContain(SENT_AFTER_DONT_SEND);
    } finally {
      seenSentAfterDontSend(declined.hash);
    }
  });

  // Then Lena's and Amélie's: "From sofiadesign.dusk" said nothing of her
  // not being a contact, and a long memo cut off whom it was from.
  it("should mark a memo that came in from an address not in the contacts as the sender's words, after whom it's from, a .dusk name or not", async () => {
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
      const [urgent, sofia, dinner] = Array.from(
        container.querySelectorAll(".history__memo"),
        (memo) => ({
          from: memo.querySelector(".history__memo-from")?.textContent ?? null,
          text: memo.textContent ?? "",
          theirs: memo.classList.contains("history__memo--theirs"),
        }),
      );

      // Whom it's from first, on its own line: a long memo can't cut it off.
      expect(urgent.theirs).toBe(true);
      expect(urgent.from).toContain(shortAddress(STRANGER));
      expect(urgent.text).toContain(
        "URGENT: wallet suspended - pay now to restore",
      );
      expect(sofia.theirs).toBe(true);
      expect(sofia.from).toContain("sofiadesign.dusk");
      expect(sofia.text).toContain("Factura 71");
      // A contact's: their memo, as the wallet's are.
      expect(dinner).toMatchObject({ from: null, theirs: false });
      expect(dinner.text).toContain("Dinner");

      // In its details too.
      await rerender({ selected: "f1".repeat(32) });

      const inDetails = container.querySelector(".tx-detail__memo");

      expect(inDetails).toHaveClass("tx-detail__memo--theirs");
      expect(inDetails).toHaveTextContent(shortAddress(STRANGER));
      expect(inDetails).toHaveTextContent(
        "URGENT: wallet suspended - pay now to restore",
      );
    } finally {
      removeContact(lucas.id);
    }
  });
});
