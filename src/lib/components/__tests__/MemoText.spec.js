import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { MemoText } from "..";

const NOTE = "It has hidden characters, shown here as codes.";

/** What's shown, without the isolates that set right-to-left runs apart. */
const withoutIsolates = (/** @type {string | null | undefined} */ text) =>
  text?.replace(/[\u2066-\u2069]/g, "");

describe("MemoText", () => {
  afterEach(cleanup);

  it("shows plain text as it is, in its lines", () => {
    const { container, queryByText } = render(MemoText, {
      text: "Factura 33\nabril",
    });

    expect(container.querySelector(".memo-text")?.textContent).toBe(
      "Factura 33\nabril"
    );
    expect(queryByText(NOTE)).toBeNull();
  });

  it.each([
    ["Hebrew letters", "Pay \u05D0 10 \u05D0 1000", "\u05D0"],
    ["Arabic letters run in", "Ref \u062810\u06281000 ok", "\u0628"],
  ])(
    "keeps the numbers beside %s in the order they're written",
    (_, text, letter) => {
      const { container, queryByText } = render(MemoText, { text });
      const memo = /** @type {HTMLElement} */ (
        container.querySelector(".memo-text")
      );
      const shown = /** @type {string} */ (memo.textContent);

      // Each right-to-left letter is set apart, so no number beside it
      // takes its direction, in a line that reads left to right.
      expect(shown.split(`\u2068${letter}\u2069`)).toHaveLength(3);
      expect(shown.startsWith("\u2066")).toBe(true);
      expect(memo.dir).toBe("ltr");
      expect(withoutIsolates(shown)).toBe(text);
      expect(queryByText(NOTE)).toBeNull();
    }
  );

  it.each([
    ["a sign request's reversed digits", "pay \u202E0001\u202C DUSK"],
    ["a name that reads backwards", "\u202Egnp.exe claim your airdrop"],
    ["a character that shows as nothing", "pay\u200B me"],
  ])("makes %s visible, and says so", (_, text) => {
    const { container, getByText } = render(MemoText, { text });
    const shown = container.querySelector(".memo-text")?.textContent;

    expect(shown).toMatch(/\\u[0-9a-f]{4}/);
    // Nothing of it can reorder what follows.
    expect(shown).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B]/);
    expect(getByText(NOTE)).toBeInTheDocument();
  });

  it.each([
    [
      "N'Ko's digits, which read right to left",
      "Invoice \u07C0\u07C0\u07C0\u07C1",
      "Its digits read right to left, so a number may not be what it looks like.",
    ],
    [
      "an Arabic-Indic zero in 105, which looks like a point",
      "Pay 1\u06605 DUSK",
      "It mixes kinds of digits, so a number may not be what it looks like.",
    ],
    [
      "both",
      "Invoice \u07C0\u07C0\u07C0\u07C1 paid 1\u06605",
      "It mixes kinds of digits, some reading right to left, so a number may not be what it looks like.",
    ],
  ])(
    "says a number may not be what it looks like for %s, with the text as it is",
    (_, text, note) => {
      const { container, getByText, queryByText } = render(MemoText, { text });

      expect(
        withoutIsolates(container.querySelector(".memo-text")?.textContent)
      ).toBe(text);
      expect(getByText(note)).toBeInTheDocument();
      expect(queryByText(NOTE)).toBeNull();
    }
  );

  it("says nothing of Arabic-Indic digits alone, which read as they look", () => {
    const { queryByText } = render(MemoText, { text: "Factura \u0661\u0660" });

    expect(queryByText(/may not be what it looks like/)).toBeNull();
  });
});
