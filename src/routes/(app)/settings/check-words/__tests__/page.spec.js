import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

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
      asked.map((n, i) => (i === 1 ? `${words[n - 1]}x` : words[n - 1])),
      ["maison", "velo", "gateau"],
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
