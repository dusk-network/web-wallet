import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { tick } from "svelte";

import { MediaQueryList } from "$lib/dusk/mocks";
import styleRules from "$lib/dusk/test-helpers/styleRules";
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
    expect(
      getByRole("group", { name: "Recovery phrase" })
    ).toHaveAccessibleDescription("Paste the whole phrase into any box.");

    await pasteInto(getByLabelText("Word 5"), `  ${TWELVE.toUpperCase()}\n`);

    expect(getAllByRole("combobox").map(valueOf)).toEqual(TWELVE.split(" "));

    await pasteInto(getByLabelText("Word 3"), TWENTY_FOUR);

    expect(getAllByRole("combobox").map(valueOf)).toEqual(
      TWENTY_FOUR.split(" ")
    );
    expect(getByRole("button", { name: "24 words" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("says which words aren't recovery words, the count and a failed checksum, after a paste", async () => {
    const { getByLabelText, getByRole, queryByRole } = render(MnemonicInput);

    await pasteInto(getByLabelText("Word 1"), TWELVE.replace("worth", "wurth"));

    expect(getByRole("alert")).toHaveTextContent(
      "Word 7 isn't a recovery word. Check its spelling."
    );
    expect(getByLabelText("Word 7")).toHaveAttribute("aria-invalid", "true");

    // A word typed right: what was said goes at once.
    await fireEvent.input(getByLabelText("Word 7"), {
      target: { value: "worth" },
    });

    expect(queryByRole("alert")).toBeNull();
    expect(getByLabelText("Word 7")).not.toHaveAttribute("aria-invalid");

    await pasteInto(getByLabelText("Word 1"), `${TWELVE} legal`);

    expect(getByRole("alert")).toHaveTextContent(
      "That's 13 words. A recovery phrase has 12 or 24."
    );

    await pasteInto(
      getByLabelText("Word 1"),
      TWELVE.replace("yellow", "winner")
    );

    expect(getByRole("alert")).toHaveTextContent(
      "These words aren't a valid recovery phrase. Check each word."
    );
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

    expect(getByRole("alert")).toHaveTextContent("Word 3 is missing.");
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
      expect(getAllByRole("combobox").map(valueOf)).toEqual(TWELVE.split(" "))
    );

    await fireEvent.click(paste);
    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent(
        "That's 25 words. A recovery phrase has 12 or 24."
      )
    );

    cleanup();
    Object.assign(navigator, { clipboard: undefined });

    expect(
      render(MnemonicInput).queryByRole("button", {
        name: "Paste recovery phrase",
      })
    ).toBeNull();
  });

  it("clears the clipboard of what was pasted, in the paste's own gesture, and says once where the browser won't let it", async () => {
    const LEFT =
      "Your recovery phrase is still on the clipboard: copy something else over it.";
    const writeText = vi.fn(() => Promise.resolve());

    Object.assign(navigator, {
      clipboard: { readText: vi.fn(() => Promise.resolve(TWELVE)), writeText },
    });

    try {
      const { getAllByText, getByLabelText, getByRole, queryByText } =
        render(MnemonicInput);

      // Pasted into a box: gone from the clipboard as it's pasted.
      await pasteInto(getByLabelText("Word 1"), TWELVE);

      expect(writeText).toHaveBeenCalledExactlyOnceWith("");
      await vi.waitFor(() => expect(queryByText(LEFT)).toBeNull());

      // With Paste too.
      await fireEvent.click(
        getByRole("button", { name: "Paste recovery phrase" })
      );
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

      expect(queryByText(LEFT)).toBeNull();

      // The browser won't let a page write it: said, once however often.
      writeText.mockImplementation(() =>
        Promise.reject(new DOMException("Denied", "NotAllowedError"))
      );
      await pasteInto(getByLabelText("Word 3"), TWELVE);
      await pasteInto(getByLabelText("Word 5"), TWELVE);

      await vi.waitFor(() => expect(getAllByText(LEFT)).toHaveLength(1));
      expect(getAllByText(LEFT)[0]).toHaveAttribute("role", "status");

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

      expect(without.getByText(LEFT)).toBeInTheDocument();
    } finally {
      Object.assign(navigator, { clipboard: undefined });
    }
  });

  it("suggests up to four recovery words from two letters, in a listbox right under the box typed in, and a tap takes one and goes on to the next box", async () => {
    const { getByLabelText, getByRole, queryByRole } = render(MnemonicInput);
    const first = getByLabelText("Word 1");

    await typeInto(first, "a");

    expect(queryByRole("listbox")).toBeNull();
    expect(first).toHaveAttribute("aria-expanded", "false");

    await typeInto(first, "ab");

    const list = getByRole("listbox", { name: "Suggestions" });
    const [abandon] = within(list).getAllByRole("option");

    expect(wordsIn(list)).toStrictEqual([
      "abandon",
      "ability",
      "able",
      "about",
    ]);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-controls", list.id);
    // The first highlighted, which the screen reader hears as the box's.
    expect(abandon).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("aria-activedescendant", abandon.id);
    // Right under its box, before the next.
    expect(
      first.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      list.compareDocumentPosition(getByLabelText("Word 2")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const able = getByRole("option", { name: "able" });

    // A press keeps the focus, and a phone's keyboard, in the box.
    expect(await fireEvent.mouseDown(able)).toBe(false);

    await fireEvent.click(able);

    expect(valueOf(first)).toBe("able");
    expect(document.activeElement).toBe(getByLabelText("Word 2"));
    expect(queryByRole("listbox")).toBeNull();
  });

  it("takes the highlighted word with Enter or Tab, moves the highlight with the arrow keys, and closes with Escape or as the box is left, a space still going on with the letters typed", async () => {
    const changed = vi.fn();
    const { getByLabelText, getByRole, queryByRole } = render(MnemonicInput, {
      events: { change: changed },
    });
    const box = (/** @type {number} */ n) => getByLabelText(`Word ${n}`);

    await typeInto(box(1), "zo");
    await fireEvent.keyDown(box(1), { key: "ArrowDown" });

    expect(getByRole("option", { name: "zoo" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(getByRole("option", { name: "zone" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(box(1)).toHaveAttribute(
      "aria-activedescendant",
      getByRole("option", { name: "zoo" }).id
    );

    // Round from the last to the first, and back.
    await fireEvent.keyDown(box(1), { key: "ArrowDown" });

    expect(getByRole("option", { name: "zone" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await fireEvent.keyDown(box(1), { key: "ArrowUp" });
    changed.mockClear();
    await fireEvent.keyDown(box(1), { key: "Enter" });

    expect(valueOf(box(1))).toBe("zoo");
    expect(changed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(box(2));
    expect(queryByRole("listbox")).toBeNull();

    // Tab: the first, as none was moved to.
    await typeInto(box(2), "wor");
    await fireEvent.keyDown(box(2), { key: "Tab" });

    expect(valueOf(box(2))).toBe("word");
    expect(document.activeElement).toBe(box(3));

    // Escape: no suggestions, the letters as they are.
    await typeInto(box(3), "ab");
    await fireEvent.keyDown(box(3), { key: "Escape" });

    expect(queryByRole("listbox")).toBeNull();
    expect(valueOf(box(3))).toBe("ab");

    // Gone as the box is left, which marks what isn't a recovery word.
    await typeInto(box(3), "abs");

    expect(getByRole("listbox")).toBeInTheDocument();

    await fireEvent.focusOut(box(3), { relatedTarget: box(5) });

    expect(queryByRole("listbox")).toBeNull();
    expect(box(3)).toHaveAttribute("aria-invalid", "true");
    expect(box(3)).toHaveAccessibleDescription("Not a recovery word");

    // A space goes on, the letters as typed, none taken: as a key, and as
    // text, as a phone's keyboard sends it.
    await typeInto(box(4), "act");
    await fireEvent.keyDown(box(4), { key: " " });

    expect(valueOf(box(4))).toBe("act");
    expect(document.activeElement).toBe(box(5));
    expect(queryByRole("listbox")).toBeNull();

    await typeInto(box(5), "lib ");

    expect(valueOf(box(5))).toBe("lib");
    expect(document.activeElement).toBe(box(6));
    expect(queryByRole("listbox")).toBeNull();
    expect(box(5)).toHaveAccessibleDescription("Not a recovery word");

    // Nothing suggested where a phrase was pasted: its last box holds "art".
    await pasteInto(box(5), TWENTY_FOUR);

    expect(valueOf(box(24))).toBe("art");
    expect(queryByRole("listbox")).toBeNull();
  });

  it("needs no chip for the one word typed, and marks in its box at once what no recovery word starts with", async () => {
    const { getByLabelText, getByRole, getByText, queryByRole } =
      render(MnemonicInput);
    const first = getByLabelText("Word 1");

    await typeInto(first, "zoo");

    expect(queryByRole("listbox")).toBeNull();
    expect(first).not.toHaveAttribute("aria-invalid");

    await typeInto(first, "zx");

    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(first).toHaveAccessibleDescription("Not a recovery word");
    expect(getByText("Not a recovery word")).toBeInTheDocument();
    // In its box, while it's typed: the sentence waits for the words' end.
    expect(queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(first);
    // And said to screen readers as it comes.
    await vi.waitFor(() =>
      expect(document.querySelector("[aria-live='polite']")).toHaveTextContent(
        "Not a recovery word"
      )
    );

    // Letters a recovery word starts with: the mark goes as they're typed.
    await typeInto(first, "ze");

    expect(first).not.toHaveAttribute("aria-invalid");
    expect(
      within(getByRole("group", { name: "Recovery phrase" })).queryByText(
        "Not a recovery word"
      )
    ).toBeNull();
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
    }
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
          })
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
          (box) => /** @type {HTMLInputElement} */ (box).readOnly
        )
      ).toBe(true);

      // A second finger on the page ends the hold.
      document.body.dispatchEvent(
        Object.assign(new Event("pointerdown", { bubbles: true }), {
          button: 0,
          pointerId: 2,
          pointerType: "touch",
        })
      );
      await tick();

      expect(grid).toHaveClass("mnemonic-input__grid--hidden");
      expect(
        getAllByRole("combobox").some(
          (box) => /** @type {HTMLInputElement} */ (box).readOnly
        )
      ).toBe(false);
      expect(valueOf(getByLabelText("Word 1"))).toBe("legal");
    } finally {
      phone.mockRestore();
    }
  });

  // Round 40, on the emulator: Firefox and Chrome name a phone's pen (and the
  // emulator's screen, which says it takes one) a fine pointer, as a mouse,
  // though nothing on the phone hovers. Chrome names a computer with a touch
  // screen as Chrome does: a finger that can't hover, and a mouse that can.
  it.each([
    ["a phone with a pen", true, () => onAPhone({ pen: true })],
    [
      "a computer with a touch screen",
      false,
      () =>
        vi
          .spyOn(window, "matchMedia")
          .mockImplementation(
            (query) =>
              /** @type {globalThis.MediaQueryList} */ (
                /** @type {unknown} */ (
                  new MediaQueryList(
                    query,
                    [
                      "(any-pointer: coarse)",
                      "(any-pointer: fine)",
                      "(any-hover: none)",
                      "(any-hover: hover)",
                    ].includes(query)
                  )
                )
              )
          ),
    ],
  ])(
    "on %s, masks the words behind Hold to show words: %s",
    async (_, isPhone, device) => {
      const spy = device();

      try {
        const { container, getByLabelText, queryByRole } =
          render(MnemonicInput);
        const grid = /** @type {HTMLElement} */ (
          container.querySelector(".mnemonic-input__grid")
        );

        await pasteInto(getByLabelText("Word 1"), TWELVE);

        expect(grid.classList.contains("mnemonic-input__grid--hidden")).toBe(
          isPhone
        );
        expect(
          queryByRole("button", { name: "Hold to show words" }) !== null
        ).toBe(isPhone);
        expect(valueOf(getByLabelText("Word 1"))).toBe("legal");
      } finally {
        spy.mockRestore();
      }
    }
  );

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

  // Codex's, round 40: 24 boxes on a phone run past its screen, and Hold to
  // show words, under them, was out of reach of the first ones: a held
  // finger can't scroll, and a second touch ends the hold.
  it("keeps Hold to show words in reach at the foot of the screen wherever the words are scrolled to, above a flow's own buttons stuck there", () => {
    const rule = styleRules(
      "../HoldToShow/HoldToShow.svelte",
      import.meta.url
    ).find(({ selector }) => selector.trim() === ".hold-to-show");

    expect(rule?.declarations).toMatchObject({
      bottom: "var(--small-gap)",
      position: "sticky",
    });

    // In a flow, as Restore: its Back and Next stuck at the foot too.
    const flow = document.createElement("div");
    const place = document.createElement("div");
    const steps = document.createElement("div");

    flow.className = "dusk-wizard";
    steps.className = "dusk-wizard__step-navigation";
    steps.style.position = "sticky";
    steps.style.bottom = "0px";
    Object.defineProperty(steps, "offsetHeight", { value: 68 });
    flow.append(place, steps);
    document.body.append(flow);

    const phone = onAPhone();

    try {
      const { getByRole } = render(MnemonicInput, { target: place });

      expect(
        getByRole("button", { name: "Hold to show words" }).style.bottom
      ).toBe("calc(68px + var(--small-gap))");
    } finally {
      phone.mockRestore();
      cleanup();
      flow.remove();
    }
  });

  it("leaves empty boxes as they are as the page is hidden: a phrase pasted on coming back shows", async () => {
    const { container, getByLabelText, queryByRole } = render(MnemonicInput);
    const grid = container.querySelector(".mnemonic-input__grid");

    // Gone to copy the phrase.
    window.dispatchEvent(new Event("blur"));
    await tick();

    expect(queryByRole("button", { name: "Show words" })).toBeNull();

    await pasteInto(getByLabelText("Word 1"), TWELVE);

    expect(grid).not.toHaveClass("mnemonic-input__grid--hidden");
    expect(queryByRole("button", { name: "Show words" })).toBeNull();
  });

  it("tells of each change, and shows a refusal from outside where its own problems show", async () => {
    const changed = vi.fn();
    const { getByLabelText, getByRole, rerender } = render(MnemonicInput, {
      events: { change: changed },
      props: { error: "" },
    });

    await pasteInto(getByLabelText("Word 1"), TWELVE);

    expect(changed).toHaveBeenCalledOnce();

    await rerender({
      error: "This recovery phrase is already in your wallet.",
    });

    expect(getByRole("alert")).toHaveTextContent(
      "This recovery phrase is already in your wallet."
    );
  });
});
