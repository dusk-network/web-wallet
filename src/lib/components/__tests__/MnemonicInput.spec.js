import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

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

describe("MnemonicInput", () => {
  afterEach(cleanup);

  it("fills every box from the first with a whole phrase pasted into any box, and 24 words make 24 boxes", async () => {
    const { getAllByRole, getByLabelText, getByRole } = render(MnemonicInput);

    expect(getAllByRole("textbox")).toHaveLength(12);
    expect(
      getByRole("group", { name: "Recovery phrase" })
    ).toHaveAccessibleDescription("Paste the whole phrase into any box.");

    await pasteInto(getByLabelText("Word 5"), `  ${TWELVE.toUpperCase()}\n`);

    expect(getAllByRole("textbox").map(valueOf)).toEqual(TWELVE.split(" "));

    await pasteInto(getByLabelText("Word 3"), TWENTY_FOUR);

    expect(getAllByRole("textbox").map(valueOf)).toEqual(
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
      "That isn't a valid recovery phrase. Check each word."
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
      expect(getAllByRole("textbox").map(valueOf)).toEqual(TWELVE.split(" "))
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
