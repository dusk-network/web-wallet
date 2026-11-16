import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import * as navigation from "$lib/navigation";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, unlockWallets } from "$lib/wallets";

import CheckWords from "../+page.svelte";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

describe("Check your recovery words", () => {
  const gotoSpy = vi.spyOn(navigation, "goto").mockResolvedValue(undefined);

  stubWalletNetwork();

  beforeEach(async () => {
    localStorage.clear();
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    // The second wallet, open now: its words are the ones asked for.
    await addWallet(B, PASSWORD);
  });

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    await vault.clear();
    localStorage.clear();
    gotoSpy.mockClear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  /**
   * The words the check asks for, by their number, and their boxes.
   *
   * @param {HTMLElement} container
   */
  const askedIn = (container) =>
    Array.from(
      container.querySelectorAll(".recovery-check__word"),
      (label) => ({
        box: /** @type {HTMLInputElement} */ (label.querySelector("input")),
        n: Number(label.textContent?.replace(/\D/g, "")),
      })
    );

  it("asks for the password first, and says a wrong one is, asking for no word", async () => {
    const { container, getByLabelText, getByRole } = render(CheckWords);

    expect(askedIn(container)).toStrictEqual([]);

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: "not the password" },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));

    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent("Wrong password.")
    );
    expect(askedIn(container)).toStrictEqual([]);
  });

  it("checks three of the open wallet's words once the password opens it, keeping nothing of them", async () => {
    const kept = JSON.stringify({ ...localStorage });
    const { container, getByLabelText, getByRole, getByText } =
      render(CheckWords);

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: PASSWORD },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(askedIn(container)).toHaveLength(3));

    const words = B.split(" ");

    for (const { box, n } of askedIn(container)) {
      await fireEvent.input(box, { target: { value: words[n - 1] } });
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));

    expect(getByText("They match.")).toBeInTheDocument();
    // Nothing of the phrase, nor what was typed, kept anywhere.
    expect(JSON.stringify({ ...localStorage })).toBe(kept);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("scheme");
  });

  it("suggests recovery words in each box as they're typed, from the wallet's list and the letters alone, and marks one that isn't a recovery word", async () => {
    const { container, getByLabelText, getByRole, getByText, queryByRole } =
      render(CheckWords);

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: PASSWORD },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(askedIn(container)).toHaveLength(3));

    const words = B.split(" ");
    const [first, second, third] = askedIn(container);

    /** @param {string} letters The list's first four words that start with them. */
    const listed = (letters) =>
      wordlist.filter((word) => word.startsWith(letters)).slice(0, 4);

    /** What the box suggests now. */
    const suggested = () =>
      within(getByRole("listbox", { name: "Suggestions" }))
        .getAllByRole("option")
        .map((option) => option.textContent?.trim());

    /**
     * Types into a box letter by letter, as a person does.
     *
     * @param {HTMLInputElement} box
     * @param {string} text
     */
    const typeInto = async (box, text) => {
      box.focus();

      for (let end = 1; end <= text.length; end++) {
        await fireEvent.input(box, { target: { value: text.slice(0, end) } });
      }
    };

    // The first letters of the very word asked: the list's words for them,
    // whether the phrase's word is among them or not.
    const letters = words[first.n - 1].slice(0, 2);

    await typeInto(first.box, letters);

    expect(suggested()).toStrictEqual(listed(letters));
    expect(first.box).toHaveAttribute("aria-expanded", "true");

    await fireEvent.keyDown(first.box, { key: "Enter" });

    expect(first.box).toHaveValue(listed(letters)[0]);
    expect(document.activeElement).toBe(second.box);
    expect(queryByRole("listbox")).toBeNull();
    expect(queryByRole("alert")).toBeNull();

    // Letters no recovery word starts with: marked in the box at once.
    await typeInto(second.box, "qx");

    expect(second.box).toHaveAttribute("aria-invalid", "true");
    expect(second.box).toHaveAccessibleDescription("Not a recovery word");

    // A tap takes one too.
    const last = words[third.n - 1].slice(0, 2);

    await typeInto(third.box, last);
    await fireEvent.click(getByRole("option", { name: listed(last).at(-1) }));

    expect(third.box).toHaveValue(listed(last).at(-1));

    // The words as written down still match.
    for (const { box, n } of askedIn(container)) {
      await fireEvent.input(box, { target: { value: words[n - 1] } });
    }

    expect(second.box).not.toHaveAttribute("aria-invalid");

    await fireEvent.click(getByRole("button", { name: "Check" }));

    expect(getByText("They match.")).toBeInTheDocument();
  });

  // Lena's: a whole word in the first box, with no suggestion to take, and
  // Enter checked at once, two boxes empty: "That doesn't match". Amélie's:
  // Enter taking a suggestion in the last box checked too.
  it("goes on to the next box with Enter, suggestions or not, and checks only once every box holds a recovery word, never saying a half-filled check doesn't match", async () => {
    const { container, getByLabelText, getByRole, queryByRole } =
      render(CheckWords);

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: PASSWORD },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(askedIn(container)).toHaveLength(3));

    const [first, second, third] = askedIn(container);
    const check = getByRole("button", { name: "Check" });

    /**
     * Types into a box letter by letter, as a person does.
     *
     * @param {HTMLInputElement} box
     * @param {string} text
     */
    const typeInto = async (box, text) => {
      box.focus();

      for (let end = 1; end <= text.length; end++) {
        await fireEvent.input(box, { target: { value: text.slice(0, end) } });
      }
    };

    // A phone's keyboard says where Enter goes.
    expect(
      [first, second, third].map(({ box }) => box.getAttribute("enterkeyhint"))
    ).toStrictEqual(["next", "next", "done"]);
    expect(check).toBeDisabled();

    // A whole word, which no list shows for: Enter goes on, and checks
    // nothing.
    await typeInto(first.box, "zoo");

    expect(queryByRole("listbox")).toBeNull();

    await fireEvent.keyDown(first.box, { key: "Enter" });

    expect(document.activeElement).toBe(second.box);
    expect(queryByRole("alert")).toBeNull();
    expect(askedIn(container)).toHaveLength(3);
    expect(check).toBeDisabled();

    // From an empty box too.
    await fireEvent.keyDown(second.box, { key: "Enter" });

    expect(document.activeElement).toBe(third.box);

    // In the last, with a box still empty: no check, and back to that box.
    await typeInto(third.box, "zone");
    await fireEvent.keyDown(third.box, { key: "Enter" });

    expect(queryByRole("alert")).toBeNull();
    expect(askedIn(container)).toHaveLength(3);
    expect(document.activeElement).toBe(second.box);

    // However it's sent, a check half filled in says nothing.
    await fireEvent.submit(
      /** @type {HTMLFormElement} */ (container.querySelector("form"))
    );

    expect(queryByRole("alert")).toBeNull();
    expect(askedIn(container)).toHaveLength(3);

    // A box whose letters are no recovery word holds none: Check stays off.
    await typeInto(second.box, "qx");

    expect(second.box).toHaveAttribute("aria-invalid", "true");
    expect(check).toBeDisabled();

    // Letters a word starts with are no word yet. Enter taking a suggestion
    // in the last box takes it, and no more: every box holds a recovery
    // word, and Check is on.
    await typeInto(second.box, "zero");
    await typeInto(third.box, "wh");

    expect(check).toBeDisabled();
    expect(getByRole("listbox", { name: "Suggestions" })).toBeInTheDocument();

    await fireEvent.keyDown(third.box, { key: "Enter" });

    expect(third.box).toHaveValue("whale");
    expect(queryByRole("alert")).toBeNull();
    expect(askedIn(container)).toHaveLength(3);
    expect(check).toBeEnabled();

    // Enter in the last box, all three typed: the check.
    await fireEvent.keyDown(third.box, { key: "Enter" });

    expect(getByRole("alert")).toHaveTextContent(
      "That doesn't match your recovery words."
    );
  });

  // Nandini's and Amélie's: one word wrong, or three made up, put all twelve
  // words on screen. A check is not a reveal.
  it("says no more than that the words don't match, with Try again, and shows them only on their own ask, behind the password again", async () => {
    const { container, getByLabelText, getByRole, queryByRole } =
      render(CheckWords);
    const words = B.split(" ");

    /** Which of the phrase's words are on the page, by their whole word. */
    const wordsShown = () =>
      words.filter((word) =>
        new RegExp(`\\b${word}\\b`).test(container.textContent ?? "")
      );

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: PASSWORD },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(askedIn(container)).toHaveLength(3));

    const asked = askedIn(container).map(({ n }) => n);

    // One word wrong, then three made up: said, and nothing else.
    for (const typed of [
      asked.map((n, i) => (i === 1 ? "zoo" : words[n - 1])),
      ["museum", "velvet", "gate"],
    ]) {
      for (const [i, { box }] of askedIn(container).entries()) {
        await fireEvent.input(box, { target: { value: typed[i] } });
      }

      await fireEvent.click(getByRole("button", { name: "Check" }));

      expect(getByRole("alert")).toHaveTextContent(
        /^That doesn't match your recovery words\. Check the words you wrote down\.$/
      );
      expect(wordsShown()).toStrictEqual([]);
      expect(container.querySelector(".dusk-words")).toBeNull();
      expect(askedIn(container)).toStrictEqual([]);
      expect(
        Array.from(container.querySelectorAll("button"), (b) =>
          b.textContent?.trim()
        )
      ).toStrictEqual(["Try again", "Show my recovery words"]);

      // Try again: the same three, empty, the first to type in.
      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(askedIn(container).map(({ n }) => n)).toStrictEqual(asked);
      expect(askedIn(container).map(({ box }) => box.value)).toStrictEqual([
        "",
        "",
        "",
      ]);
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(askedIn(container)[0].box)
      );
      expect(queryByRole("alert")).toBeNull();
    }

    // Show my recovery words, apart: the password again first.
    for (const { box } of askedIn(container)) {
      await fireEvent.input(box, { target: { value: "zoo" } });
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));
    await fireEvent.click(
      getByRole("button", { name: "Show my recovery words" })
    );

    const password = getByLabelText("Password you unlock with");

    expect(password).toHaveValue("");
    await vi.waitFor(() => expect(document.activeElement).toBe(password));
    expect(wordsShown()).toStrictEqual([]);

    await fireEvent.input(password, { target: { value: "not the password" } });
    await fireEvent.click(
      getByRole("button", { name: "Show my recovery words" })
    );
    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent("Wrong password.")
    );
    expect(wordsShown()).toStrictEqual([]);

    await fireEvent.input(password, { target: { value: PASSWORD } });
    await fireEvent.click(
      getByRole("button", { name: "Show my recovery words" })
    );

    await vi.waitFor(() =>
      expect(
        Array.from(
          container.querySelectorAll(".dusk-words__word"),
          (word) => word.textContent
        )
      ).toStrictEqual(words)
    );
    expect(askedIn(container)).toStrictEqual([]);
  });
});
