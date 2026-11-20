import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { tick } from "svelte";

import { onAPhone } from "$lib/test-helpers";

import { MnemonicInput } from "..";

// Public BIP39 test phrases, never a real wallet's.
const TWELVE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const TWENTY_FOUR = `${"abandon ".repeat(23)}art`;

/**
 * Pastes text into a box, as a person does.
 *
 * @param {HTMLElement} box
 * @param {string} text
 */
const pasteInto = (box, text) =>
  fireEvent.paste(box, { clipboardData: { getData: () => text } });

/** @param {HTMLElement} box */
const valueOf = (box) => /** @type {HTMLInputElement} */ (box).value;

/**
 * Types into a box as a person does: with the focus, letter by letter.
 *
 * @param {HTMLElement} box
 * @param {string} text
 */
const typeInto = async (box, text) => {
  box.focus();

  for (let end = 1; end <= text.length; end++) {
    await fireEvent.input(box, { target: { value: text.slice(0, end) } });
  }
};

/** @param {HTMLElement} list */
const wordsIn = (list) =>
  within(list)
    .getAllByRole("option")
    .map((option) => option.textContent?.trim());

describe("MnemonicInput", () => {
  afterEach(cleanup);

  it("fills every box from the first with a whole phrase pasted into any box, and 24 words make 24 boxes", async () => {
    const { getAllByRole, getByLabelText, getByRole } = render(MnemonicInput);

    expect(getAllByRole("combobox")).toHaveLength(12);

    await pasteInto(getByLabelText("Word 5"), `  ${TWELVE.toUpperCase()}\n`);

    expect(getAllByRole("combobox").map(valueOf)).toEqual(TWELVE.split(" "));

    await pasteInto(getByLabelText("Word 3"), TWENTY_FOUR);

    expect(getAllByRole("combobox").map(valueOf)).toEqual(
      TWENTY_FOUR.split(" "),
    );
    expect(getByRole("button", { name: "24 words" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says which words aren't recovery words, the count and a failed checksum, after a paste", async () => {
    const { getByLabelText, getByRole, queryByRole } = render(MnemonicInput);

    await pasteInto(getByLabelText("Word 1"), TWELVE.replace("worth", "wurth"));

    expect(getByRole("alert")).toHaveTextContent(/\b7\b/);
    expect(getByLabelText("Word 7")).toHaveAttribute("aria-invalid", "true");

    // A word typed right: what was said goes at once.
    await fireEvent.input(getByLabelText("Word 7"), {
      target: { value: "worth" },
    });

    expect(queryByRole("alert")).toBeNull();
    expect(getByLabelText("Word 7")).not.toHaveAttribute("aria-invalid");

    await pasteInto(getByLabelText("Word 1"), `${TWELVE} legal`);

    expect(getByRole("alert")).toHaveTextContent(/\b13\b/);

    // Twelve recovery words, though not a phrase: said, and not as a count.
    await pasteInto(
      getByLabelText("Word 1"),
      TWELVE.replace("yellow", "winner"),
    );

    expect(getByRole("alert")).not.toHaveTextContent("13");
  });

  it("says which words are missing once the focus leaves the boxes, and puts a few words where they're typed", async () => {
    const { getByLabelText, getByRole } = render(MnemonicInput);

    await fireEvent.input(getByLabelText("Word 1"), {
      target: { value: "legal winner" },
    });

    expect(valueOf(getByLabelText("Word 1"))).toBe("legal");
    expect(valueOf(getByLabelText("Word 2"))).toBe("winner");

    await fireEvent.input(getByLabelText("Word 4"), {
      target: { value: "year" },
    });
    await fireEvent.focusOut(getByLabelText("Word 4"), {
      relatedTarget: document.body,
    });

    expect(getByRole("alert")).toHaveTextContent(/\b3\b/);
  });

  it("puts what's copied in the boxes with Paste, as a paste into the first box, where the browser lets a page read it", async () => {
    const readText = vi
      .fn()
      .mockResolvedValueOnce(TWELVE)
      .mockResolvedValueOnce(`${TWENTY_FOUR} abandon`);

    Object.assign(navigator, { clipboard: { readText } });

    const { getAllByRole, getByRole } = render(MnemonicInput);
    const paste = getByRole("button", { name: "Paste recovery phrase" });

    await fireEvent.click(paste);
    await vi.waitFor(() =>
      expect(getAllByRole("combobox").map(valueOf)).toEqual(TWELVE.split(" ")),
    );

    await fireEvent.click(paste);
    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent(/\b25\b/),
    );

    cleanup();
    Object.assign(navigator, { clipboard: undefined });

    expect(
      render(MnemonicInput).queryByRole("button", {
        name: "Paste recovery phrase",
      }),
    ).toBeNull();
  });

  it("clears the clipboard of what was pasted, in the paste's own gesture, and says once where the browser won't let it", async () => {
    const writeText = vi.fn(() => Promise.resolve());

    Object.assign(navigator, {
      clipboard: { readText: vi.fn(() => Promise.resolve(TWELVE)), writeText },
    });

    try {
      const { getAllByRole, getByLabelText, getByRole, queryByRole } =
        render(MnemonicInput);

      // Pasted into a box: gone from the clipboard as it's pasted.
      await pasteInto(getByLabelText("Word 1"), TWELVE);

      expect(writeText).toHaveBeenCalledExactlyOnceWith("");
      await vi.waitFor(() => expect(queryByRole("status")).toBeNull());

      // With Paste too.
      await fireEvent.click(
        getByRole("button", { name: "Paste recovery phrase" }),
      );
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

      expect(queryByRole("status")).toBeNull();

      // The browser won't let a page write it: said, once however often.
      writeText.mockImplementation(() =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
      );
      await pasteInto(getByLabelText("Word 3"), TWELVE);
      await pasteInto(getByLabelText("Word 5"), TWELVE);

      await vi.waitFor(() => expect(getAllByRole("status")).toHaveLength(1));

      // Nothing pasted, as a word typed: nothing to clear.
      writeText.mockClear();
      await fireEvent.input(getByLabelText("Word 2"), {
        target: { value: "winner" },
      });

      expect(writeText).not.toHaveBeenCalled();
      cleanup();

      // Where a page can't write the clipboard at all.
      Object.assign(navigator, { clipboard: undefined });

      const without = render(MnemonicInput);

      await pasteInto(without.getByLabelText("Word 1"), TWELVE);

      expect(without.getByRole("status")).toBeInTheDocument();
    } finally {
      Object.assign(navigator, { clipboard: undefined });
    }
  });

  // Marek's, in Firefox for Android: the app switcher and the tab list kept
  // a picture of all twelve words, as nothing hid them again.
  it.each([
    [
      "the window loses the focus",
      () => window.dispatchEvent(new Event("blur")),
    ],
    ["the page is left", () => window.dispatchEvent(new Event("pagehide"))],
    [
      "the page goes to the background",
      () => {
        const visibility = vi
          .spyOn(document, "visibilityState", "get")
          .mockReturnValue("hidden");

        document.dispatchEvent(new Event("visibilitychange"));
        visibility.mockRestore();
      },
    ],
  ])(
    "hides the words as %s, each as a password, with no suggestions, until Show words",
    async (_, hide) => {
      const { container, getByLabelText, getByRole, queryByRole } =
        render(MnemonicInput);
      const grid = /** @type {HTMLElement} */ (
        container.querySelector(".mnemonic-input__grid")
      );

      await pasteInto(getByLabelText("Word 1"), TWELVE);

      expect(grid).not.toHaveClass("mnemonic-input__grid--hidden");
      expect(queryByRole("button", { name: "Show words" })).toBeNull();

      hide();
      await tick();

      expect(grid).toHaveClass("mnemonic-input__grid--hidden");

      // Typed in meanwhile: still hidden, and nothing suggested.
      await typeInto(getByLabelText("Word 12"), "ab");

      expect(queryByRole("listbox")).toBeNull();
      expect(grid).toHaveClass("mnemonic-input__grid--hidden");

      // Shown again only as asked.
      await fireEvent.click(getByRole("button", { name: "Show words" }));

      expect(grid).not.toHaveClass("mnemonic-input__grid--hidden");
      expect(queryByRole("button", { name: "Show words" })).toBeNull();
      expect(valueOf(getByLabelText("Word 1"))).toBe("legal");
    },
  );

  // Decided after round 39: on a phone, the words typed show only while
  // held, as the extension's do in Firefox for Android: its app switcher can
  // keep a picture of the page as it's left, before the page hears of it.
  it("masks each box's word on a phone as a password is, keeps its suggestions, and shows the words, read only, only while Hold to show words is held", async () => {
    const phone = onAPhone();

    try {
      const {
        container,
        getAllByRole,
        getByLabelText,
        getByRole,
        queryByRole,
      } = render(MnemonicInput);
      const grid = /** @type {HTMLElement} */ (
        container.querySelector(".mnemonic-input__grid")
      );
      /** @param {string} type */
      const finger = (type) =>
        fireEvent(
          getByRole("button", { name: "Hold to show words" }),
          Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
            button: 0,
            pointerId: 1,
            pointerType: "touch",
          }),
        );

      await pasteInto(getByLabelText("Word 1"), TWELVE);

      // At rest: masked, though nothing left the page.
      expect(grid).toHaveClass("mnemonic-input__grid--hidden");
      expect(queryByRole("button", { name: "Show words" })).toBeNull();

      // Typed masked, its suggestions kept.
      await fireEvent.input(getByLabelText("Word 12"), {
        target: { value: "" },
      });
      await typeInto(getByLabelText("Word 12"), "ab");

      expect(wordsIn(getByRole("listbox"))).toContain("abandon");
      expect(grid).toHaveClass("mnemonic-input__grid--hidden");

      await finger("pointerdown");

      expect(grid).not.toHaveClass("mnemonic-input__grid--hidden");
      expect(
        getAllByRole("combobox").every(
          (box) => /** @type {HTMLInputElement} */ (box).readOnly,
        ),
      ).toBe(true);

      // A second finger on the page ends the hold.
      document.body.dispatchEvent(
        Object.assign(new Event("pointerdown", { bubbles: true }), {
          button: 0,
          pointerId: 2,
          pointerType: "touch",
        }),
      );
      await tick();

      expect(grid).toHaveClass("mnemonic-input__grid--hidden");
      expect(
        getAllByRole("combobox").some(
          (box) => /** @type {HTMLInputElement} */ (box).readOnly,
        ),
      ).toBe(false);
      expect(valueOf(getByLabelText("Word 1"))).toBe("legal");
    } finally {
      phone.mockRestore();
    }
  });

  // Round 40, on the emulator: Firefox and Chrome name a phone's pen (and the
  // emulator's screen, which says it takes one) a fine pointer, as a mouse,
  // though nothing on the phone hovers.
  it("on a phone with a pen, masks the words behind Hold to show words", async () => {
    const phone = onAPhone({ pen: true });

    try {
      const { container, getByLabelText, queryByRole } = render(MnemonicInput);
      const grid = /** @type {HTMLElement} */ (
        container.querySelector(".mnemonic-input__grid")
      );

      await pasteInto(getByLabelText("Word 1"), TWELVE);

      expect(grid).toHaveClass("mnemonic-input__grid--hidden");
      expect(
        queryByRole("button", { name: "Hold to show words" }),
      ).not.toBeNull();
      expect(valueOf(getByLabelText("Word 1"))).toBe("legal");
    } finally {
      phone.mockRestore();
    }
  });

  // Codex's, round 40: on a phone, a page left with a box's suggestions
  // open kept them, the word being typed in plain words, for the app
  // switcher's picture.
  it("closes a box's suggestions as the page goes, on a phone too, and offers them again as typing goes on", async () => {
    const phone = onAPhone();

    try {
      const { getByLabelText, getByRole, queryByRole } = render(MnemonicInput);

      await typeInto(getByLabelText("Word 1"), "leg");

      expect(wordsIn(getByRole("listbox"))).toContain("legal");

      window.dispatchEvent(new Event("blur"));
      await tick();

      expect(queryByRole("listbox")).toBeNull();

      await typeInto(getByLabelText("Word 1"), "lega");

      expect(wordsIn(getByRole("listbox"))).toContain("legal");
    } finally {
      phone.mockRestore();
    }
  });
});
