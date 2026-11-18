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
import { tick } from "svelte";
import { get } from "svelte/store";
import * as SvelteKit from "@sveltejs/kit";
import { ProfileGenerator } from "@dusk/w3sper";

import { networkStore, settingsStore, walletStore } from "$lib/stores";
import { onAPhone } from "$lib/test-helpers";
import * as walletLib from "$lib/wallet";
import * as navigation from "$lib/navigation";
import vault from "$lib/vault";
import * as shuffleArray from "$lib/dusk/array";

import Create from "../+page.svelte";
import NetworkSync from "../NetworkSync.svelte";
import { load } from "../+page.js";

const getKey = (/** @type {string} */ key) => (/** @type {any} */ value) =>
  value[key];
/** @type {(userId: string) => (settings: SettingsStoreContent) => SettingsStoreContent} */
const setUserId = (userId) => (settings) => ({ ...settings, userId });

vi.mock("@sveltejs/kit", async (importOriginal) => ({
  ...(await importOriginal()),
  error: vi.fn(),
}));

/**
 * @param {HTMLElement} input
 * @param {*} value
 * @returns {Promise<boolean>}
 */
const fireInput = (input, value) =>
  fireEvent.input(input, { target: { value } });

/** @param {HTMLElement} element */
const asInput = (element) => /** @type {HTMLInputElement} */ (element);

describe("Create", async () => {
  const currentBlockHeight = 1536n;
  const mnemonic =
    "cart dad sail wreck robot grit combine noble rapid farm slide sad";
  const mnemonicShuffled = [
    "grit",
    "wreck",
    "cart",
    "dad",
    "rapid",
    "sail",
    "robot",
    "combine",
    "noble",
    "slide",
    "sad",
    "farm",
  ];
  const pwd = "passwordpassword";
  const seed = walletLib.getSeedFromMnemonic(mnemonic);
  const userId = await walletLib
    .profileGeneratorFrom(seed)
    .then(getKey("default"))
    .then(getKey("address"))
    .then(String);

  const baseProps = {
    data: { currentBlockHeight },
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  /**
   * Types the three words the check asks for, as written down, and presses
   * Check.
   *
   * @param {(role: string, options: object) => HTMLElement} getByRole
   */
  async function checkWords(getByRole) {
    const words = mnemonic.split(" ");

    for (const label of document.querySelectorAll(".recovery-check__word")) {
      const n = Number(label.textContent?.replace(/\D/g, ""));

      await fireInput(
        asInput(/** @type {HTMLElement} */ (label.querySelector("input"))),
        words[n - 1]
      );
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));
  }

  vi.mocked(SvelteKit.error).mockImplementation(() => {
    throw new Error("SvelteKit Error Simulation");
  });

  vi.spyOn(walletLib, "generateMnemonic").mockReturnValue(mnemonic);
  vi.spyOn(shuffleArray, "shuffleArray").mockReturnValue(mnemonicShuffled);

  const gotoSpy = vi.spyOn(navigation, "goto");
  const settingsResetSpy = vi.spyOn(settingsStore, "reset");
  const clearAndInitSpy = vi
    .spyOn(walletStore, "clearLocalDataAndInit")
    .mockResolvedValue(undefined);
  const initWalletSpy = vi.spyOn(walletLib, "initializeWallet");

  beforeEach(() => {
    settingsStore.reset();
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  afterAll(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@sveltejs/kit");
  });

  describe("Create page load", () => {
    const blockHeightSpy = vi
      .spyOn(networkStore, "getCurrentBlockHeight")
      .mockResolvedValue(currentBlockHeight);

    afterEach(() => {
      blockHeightSpy.mockClear();
    });

    afterAll(() => {
      blockHeightSpy.mockRestore();
    });

    it('should retrieve the current block height and pass it to the page as "page data"', async () => {
      // @ts-ignore we don't care for load parameters here
      await expect(load()).resolves.toStrictEqual({ currentBlockHeight });
    });

    it("should call the svelte kit error if the current block height can't be retrieved", async () => {
      const svelteKitErrorSpy = vi.spyOn(SvelteKit, "error");

      blockHeightSpy.mockRejectedValueOnce(new Error("some error"));

      // @ts-ignore we don't care for load parameters here
      await expect(load()).rejects.toThrow();

      expect(svelteKitErrorSpy).toHaveBeenCalledTimes(1);
      expect(svelteKitErrorSpy).toHaveBeenCalledWith(500, expect.any(String));

      svelteKitErrorSpy.mockRestore();
    });
  });

  it("should render the Existing Wallet notice step of the Create flow if there is a userId saved in localStorage", () => {
    settingsStore.update(setUserId(userId));

    const { getByRole } = render(Create, baseOptions);

    expect(
      getByRole("button", { name: "Remove and create" })
    ).toBeInTheDocument();
  });

  it("should sum up the terms, with their own links to the Terms of Use and the Privacy Policy", () => {
    const { getByRole, getByText } = render(Create, baseOptions);

    expect(
      getByText(
        "Your keys stay in this browser, and only you hold them: Dusk can't recover them. The wallet has no analytics, and gets the DUSK price from CoinGecko."
      )
    ).toBeInTheDocument();
    expect(getByRole("link", { name: "Terms of use" })).toHaveAttribute(
      "href",
      "https://dusk.network/terms-of-use/"
    );
    expect(getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "https://dusk.network/privacy-policy/"
    );
  });

  it("should call it the recovery phrase, warn that anyone with its words can take the DUSK, and say how to check it", async () => {
    const { container, getByLabelText, getByRole, getAllByRole, getByText } =
      render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const agreementStep = container.textContent ?? "";

    expect(agreementStep).toMatch(/Keep it safe/);
    expect(agreementStep).toMatch(/my recovery phrase/);
    expect(agreementStep).not.toMatch(/mnemonic/i);
    expect(
      getByLabelText(
        "I understand that without my recovery phrase I cannot access my wallet and its assets."
      )
    ).toHaveAttribute("type", "checkbox");
    expect(
      getByLabelText(
        "Anyone with these 12 words can take my DUSK. Dusk will never ask for them."
      )
    ).toHaveAttribute("type", "checkbox");

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(
      getByText(/^Type words \d+, \d+ and \d+ as you wrote them down\.$/)
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/mnemonic/i);
  });

  it("should render the `Securely store your mnemonic phrase!` agreement step after the ToS", async () => {
    const { getByRole } = render(Create, baseOptions);

    const mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(42);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    mathRandomSpy.mockRestore();
  });

  it("should title each step on one line, and go on with a primary Next beside Back, as the wallet's flows do", async () => {
    const { getByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    expect(getByRole("heading", { level: 2 }).innerHTML).toBe(
      "Back up your recovery phrase"
    );
    expect(getByRole("link", { name: "Back" })).toHaveClass(
      "dusk-anchor-button--variant--tertiary"
    );
    expect(getByRole("button", { name: "Next" })).toHaveClass(
      "dusk-button--variant--primary"
    );
  });

  it("should not allow the user proceed unless both agreement checks are selected on the `Securely store your mnemonic phrase!` step", async () => {
    const { getByRole, getAllByRole, getByText } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const firstCheckbox = getAllByRole("checkbox")[0];
    const secondCheckbox = getAllByRole("checkbox")[1];
    const nextButton = getByRole("button", { name: "Next" });

    expect(getByText("Tick both boxes to continue.")).toBeInTheDocument();

    // Select the first checkbox
    await fireEvent.click(firstCheckbox);

    // Ensure Next is disabled
    expect(nextButton).toBeDisabled();

    // Unselect the first checkbox
    await fireEvent.click(firstCheckbox);

    // Select the second checkbox
    await fireEvent.click(secondCheckbox);

    // Ensure Next is disabled
    expect(getByRole("button", { name: "Next" })).toBeDisabled();

    // Select first checkbox too
    await fireEvent.click(firstCheckbox);

    // Ensure Next is enabled
    expect(nextButton).toBeEnabled();
  });

  it("correctly renders the Mnemonic Preview page", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
  });

  it("correctly renders the Mnemonic Verification page", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
  });

  // Marek's, in Firefox for Android: the app switcher and the tab list kept
  // a picture of the words, as nothing hid them again.
  it("hides the words to write down the moment the page is hidden, and what's typed in their check, until Show words", async () => {
    const { container, getAllByRole, getByRole, queryByRole } = render(
      Create,
      baseOptions
    );
    const words = mnemonic.split(" ");
    /** Which of the phrase's words are on the page, by their whole word. */
    const wordsShown = () =>
      words.filter((word) =>
        new RegExp(`\\b${word}\\b`).test(container.textContent ?? "")
      );
    const shownWords = () =>
      Array.from(
        container.querySelectorAll(".dusk-words__word"),
        (word) => word.textContent?.trim() ?? ""
      );

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(shownWords()).toStrictEqual(words);

    // The window loses the focus, as the app switcher opens: hidden at once.
    window.dispatchEvent(new Event("blur"));
    await tick();

    expect(shownWords()).toStrictEqual(words.map(() => "•••••"));
    expect(wordsShown()).toStrictEqual([]);

    // Back only as asked.
    await fireEvent.click(getByRole("button", { name: "Show words" }));

    expect(shownWords()).toStrictEqual(words);
    expect(queryByRole("button", { name: "Show words" })).toBeNull();

    // Their check: what's typed hidden as the page goes to the background.
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const boxes = container.querySelector(".recovery-check__words");

    for (const box of container.querySelectorAll(
      ".recovery-check__word input"
    )) {
      await fireInput(/** @type {HTMLInputElement} */ (box), "museum");
    }

    expect(boxes).not.toHaveClass("recovery-check__words--hidden");

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockRestore();
    await tick();

    expect(boxes).toHaveClass("recovery-check__words--hidden");

    await fireEvent.click(getByRole("button", { name: "Show words" }));

    expect(boxes).not.toHaveClass("recovery-check__words--hidden");
  });

  // Amélie's and Chen's, decided after round 39: on a phone, the words show
  // only while held, as the extension's do in Firefox for Android, so the
  // app switcher can't keep them, whenever it takes its picture.
  it("shows the words to write down on a phone only while Hold to show words is held, and masks what's typed in their check, its suggestions kept", async () => {
    const phone = onAPhone();

    try {
      const { container, getAllByRole, getByRole, queryByRole } = render(
        Create,
        baseOptions
      );
      const words = mnemonic.split(" ");
      const shownWords = () =>
        Array.from(
          container.querySelectorAll(".dusk-words__word"),
          (word) => word.textContent?.trim() ?? ""
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

      await fireEvent.click(getByRole("button", { name: "Accept" }));
      await fireEvent.click(getAllByRole("checkbox")[0]);
      await fireEvent.click(getAllByRole("checkbox")[1]);
      await fireEvent.click(getByRole("button", { name: "Next" }));

      // At rest: none of them, though nothing left the page.
      expect(shownWords()).toStrictEqual(words.map(() => "•••••"));
      expect(queryByRole("button", { name: "Show words" })).toBeNull();

      await finger("pointerdown");

      expect(shownWords()).toStrictEqual(words);

      await finger("pointerup");

      expect(shownWords()).toStrictEqual(words.map(() => "•••••"));

      // Held as the phone leaves the page: masked at once.
      await finger("pointerdown");
      window.dispatchEvent(new Event("pagehide"));
      await tick();

      expect(shownWords()).toStrictEqual(words.map(() => "•••••"));

      // Their check: masked as it's typed, its suggestions kept.
      await fireEvent.click(getByRole("button", { name: "Next" }));

      const boxes = container.querySelector(".recovery-check__words");
      const first = /** @type {HTMLInputElement} */ (
        container.querySelector(".recovery-check__word input")
      );

      first.focus();
      await fireInput(first, "mu");

      expect(boxes).toHaveClass("recovery-check__words--hidden");
      expect(getByRole("listbox")).toBeInTheDocument();
      expect(queryByRole("button", { name: "Show words" })).toBeNull();

      await finger("pointerdown");

      expect(boxes).not.toHaveClass("recovery-check__words--hidden");
      expect(first.readOnly).toBe(true);

      await finger("pointercancel");

      expect(boxes).toHaveClass("recovery-check__words--hidden");
      expect(first.readOnly).toBe(false);
    } finally {
      phone.mockRestore();
    }
  });

  // Then Nandini's and Amélie's: one word wrong, or three made up, put all
  // twelve on screen. A check is not a reveal.
  it("asks for three of the words as written down, with Check, and Skip for now until they match, saying no more than that one doesn't, and going back to the words only on its own ask", async () => {
    const { container, getAllByRole, getByRole, getByText, queryByRole } =
      render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    /** The boxes the check asks in. */
    const boxesShown = () =>
      /** @type {HTMLInputElement[]} */ (
        Array.from(container.querySelectorAll(".recovery-check__word input"))
      );
    const boxes = boxesShown();
    const asked = Array.from(
      container.querySelectorAll(".recovery-check__word"),
      (label) => Number(label.textContent?.replace(/\D/g, ""))
    );

    // Three, in order, each its own box, as Import's take words.
    expect(boxes).toHaveLength(3);
    expect(asked).toStrictEqual([...asked].sort((a, b) => a - b));
    expect(new Set(asked).size).toBe(3);

    for (const box of boxes) {
      expect(box).toHaveAttribute("autocomplete", "off");
      expect(box).toHaveAttribute("autocorrect", "off");
      expect(box).toHaveAttribute("autocapitalize", "none");
      expect(box).toHaveAttribute("spellcheck", "false");
    }

    expect(getByRole("button", { name: "Skip for now" })).toBeEnabled();
    // Amélie's: Skip for now was the big black button, Check a pale one.
    expect(getByRole("button", { name: "Check" })).toHaveClass(
      "dusk-button--variant--primary"
    );
    expect(getByRole("button", { name: "Skip for now" })).toHaveClass(
      "dusk-button--variant--secondary"
    );

    const words = mnemonic.split(" ");

    /** Which of the phrase's words are on the page, by their whole word. */
    const wordsShown = () =>
      words.filter((word) =>
        new RegExp(`\\b${word}\\b`).test(container.textContent ?? "")
      );

    // One wrong, then three made up: said, and nothing else.
    for (const typed of [
      asked.map((n, i) => (i === 1 ? "zoo" : words[n - 1])),
      ["museum", "velvet", "gate"],
    ]) {
      for (const [i, box] of boxesShown().entries()) {
        await fireInput(box, typed[i]);
      }

      await fireEvent.click(getByRole("button", { name: "Check" }));

      expect(getByRole("alert")).toHaveTextContent(
        /^That doesn't match your recovery words\. Check the words you wrote down\.$/
      );
      expect(wordsShown()).toStrictEqual([]);
      expect(container.querySelector(".dusk-words")).toBeNull();
      expect(boxesShown()).toStrictEqual([]);
      expect(getByRole("button", { name: "Skip for now" })).toBeEnabled();
      // Try again leads, Skip for now quieter.
      expect(getByRole("button", { name: "Try again" })).toHaveClass(
        "dusk-button--variant--primary"
      );
      expect(getByRole("button", { name: "Skip for now" })).toHaveClass(
        "dusk-button--variant--secondary"
      );

      // Try again: the same three, empty, the first to type in.
      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(
        Array.from(container.querySelectorAll(".recovery-check__word"), (l) =>
          Number(l.textContent?.replace(/\D/g, ""))
        )
      ).toStrictEqual(asked);
      expect(boxesShown().map((box) => box.value)).toStrictEqual(["", "", ""]);
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(boxesShown()[0])
      );
      expect(queryByRole("alert")).toBeNull();
    }

    // Right: they match, and Next goes on. Compared as both wallets compare
    // them: case, the spaces around and a keyboard's fullwidth letters aside.
    const fullwidth = (/** @type {string} */ word) =>
      word.replace(/[a-z]/gi, (letter) =>
        String.fromCharCode(letter.charCodeAt(0) + 0xfee0)
      );

    for (const [i, box] of boxesShown().entries()) {
      await fireInput(
        box,
        i === 1
          ? ` ${words[asked[1] - 1].toUpperCase()} `
          : i === 2
            ? fullwidth(words[asked[2] - 1])
            : words[asked[i] - 1]
      );
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));

    expect(getByText("They match.")).toBeInTheDocument();
    expect(queryByRole("alert")).toBeNull();

    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getByRole("heading", { level: 2 })).toHaveTextContent(
      "Set a password"
    );
  });

  it("goes back to the words with Show my recovery words, after a check that doesn't match", async () => {
    const { container, getAllByRole, getByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    for (const box of container.querySelectorAll(
      ".recovery-check__word input"
    )) {
      await fireInput(/** @type {HTMLElement} */ (box), "zoo");
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));
    await fireEvent.click(
      getByRole("button", { name: "Show my recovery words" })
    );

    expect(getByRole("heading", { level: 2 })).toHaveTextContent(
      "Back up your recovery phrase"
    );
    expect(
      Array.from(
        container.querySelectorAll(".dusk-words__word"),
        (word) => word.textContent
      )
    ).toStrictEqual(mnemonic.split(" "));

    // And on to a new check of them.
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(getByRole("heading", { level: 2 })).toHaveTextContent(
      "Check your recovery words"
    );
    expect(
      container.querySelectorAll(".recovery-check__word input")
    ).toHaveLength(3);
  });

  it("goes on past the check with Skip for now, the words never checked", async () => {
    const { getAllByRole, getByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Skip for now" }));

    expect(getByRole("heading", { level: 2 })).toHaveTextContent(
      "Set a password"
    );
  });

  it("ensures the Password step renders as expected", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await checkWords(getByRole);

    await tick();

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Password enabled

    await fireEvent.click(getByRole("switch"));

    // Password disabled
  });

  it("ensures the Network Syncing step renders as expected", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await checkWords(getByRole);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
  });

  it("should write the block height in the language set, whatever the browser's", () => {
    settingsStore.update((store) => ({ ...store, language: "de-DE" }));

    const { getByDisplayValue } = render(NetworkSync, {
      currentBlockHeight: 1_234_567n,
    });

    expect(navigator.language).not.toMatch(/^de/);
    expect(getByDisplayValue("1.234.567")).toBeInTheDocument();
    settingsStore.reset();
  });

  it("should keep the block height out of the way, under Advanced, on the Network Syncing step", async () => {
    const { container, getByRole, getAllByRole, getByText } = render(
      Create,
      baseOptions
    );

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await checkWords(getByRole);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const advanced = /** @type {HTMLDetailsElement} */ (
      container.querySelector("details")
    );

    expect(getByText("Next, the wallet syncs with the network.")).toBeVisible();
    expect(advanced.open).toBe(false);
    expect(advanced.querySelector("summary")).toHaveTextContent("Advanced");
    expect(advanced).toContainElement(getByRole("textbox", { hidden: true }));
  });

  it("should hint at how strong the password is once it is long enough", async () => {
    const { container, getByRole, getAllByRole, getByPlaceholderText } = render(
      Create,
      baseOptions
    );

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await checkWords(getByRole);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    const password = getByPlaceholderText("Set password");
    const hint = () => container.querySelector(".password-strength");

    await fireInput(password, "pass");

    expect(hint()).toBeNull();

    await fireInput(password, "password");

    expect(hint()).toHaveTextContent(
      "Weak password: easy to guess. Make it longer, or use a few unrelated words."
    );
    expect(password).toHaveAccessibleDescription(hint()?.textContent?.trim());

    await fireInput(password, "tulips4ever");

    expect(hint()).toHaveTextContent("Fair password. Longer is safer.");

    await fireInput(password, "correct horse battery");

    expect(hint()).toHaveTextContent("Strong password.");
  });

  it("ensures the All Done step renders as expected", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await checkWords(getByRole);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Once the wallet is open.
    await vi.waitFor(() => {
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
    });
  });

  it("should initialize the wallet without setting a password", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    // ToS step
    await fireEvent.click(getByRole("button", { name: "Accept" }));

    // Mnemonic Agreement step
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Mnemonic Generate step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Mnemonic Validate step
    await checkWords(getByRole);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Set Password step
    await fireEvent.click(getByRole("switch"));

    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(vault.exists()).toBe(false);

    // Network Syncing step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(settingsResetSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledWith(mnemonic, currentBlockHeight);

    await vi.waitFor(() => {
      expect(get(settingsStore).walletCreationBlockHeight).toBe(
        currentBlockHeight
      );
    });
    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      currentBlockHeight,
      { key: "", n: 1 }
    );

    // All Done step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/dashboard", { replaceState: true });
  });

  it("should go on from All set only once the wallet is open, and say so when it can't open", async () => {
    /** @param {() => Promise<void>} open */
    const toAllSet = async (open) => {
      clearAndInitSpy.mockImplementationOnce(open);

      const rendered = render(Create, baseOptions);
      const { getByRole, getAllByRole } = rendered;

      await fireEvent.click(getByRole("button", { name: "Accept" }));
      await fireEvent.click(getAllByRole("checkbox")[0]);
      await fireEvent.click(getAllByRole("checkbox")[1]);
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "Next" }));

      await checkWords(getByRole);

      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("switch"));
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await fireEvent.click(getByRole("button", { name: "Next" }));
      await vi.waitUntil(() => clearAndInitSpy.mock.calls.length === 1);

      return rendered;
    };
    const opening = Promise.withResolvers();
    const { getByRole } = await toAllSet(
      () => /** @type {Promise<void>} */ (opening.promise)
    );

    // All set, while the wallet opens.
    expect(getByRole("button", { name: "Next" })).toBeDisabled();

    opening.resolve(undefined);

    await vi.waitFor(() => {
      expect(getByRole("button", { name: "Next" })).toBeEnabled();
    });
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledWith("/dashboard", { replaceState: true });

    cleanup();
    clearAndInitSpy.mockClear();
    gotoSpy.mockClear();

    const failed = await toAllSet(() =>
      Promise.reject(new Error("some error"))
    );

    await vi.waitFor(() => {
      expect(failed.getByText("The wallet couldn't open")).toBeInTheDocument();
    });
    expect(
      failed.getByText("Restore it with the recovery phrase you wrote down.")
    ).toBeInTheDocument();
    expect(failed.queryByText("You are all set!")).toBeNull();
    expect(failed.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(gotoSpy).not.toHaveBeenCalled();
  });

  it("should initialize the wallet encrypted mnemonic saved in localStorage, and open the page a link asked for, as Send filled in by a request", async () => {
    // A payment link opened before there was a wallet.
    navigation.keepPlace({
      pathname: "/some-base-path/dashboard/send/",
      search: "?to=someone&amount=0.011&network=testnet",
    });

    const { getByPlaceholderText, getByRole, getAllByRole } = render(
      Create,
      baseOptions
    );

    // ToS step
    await fireEvent.click(getByRole("button", { name: "Accept" }));

    // Mnemonic Agreement step
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Mnemonic Generate step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Mnemonic Validate step
    await checkWords(getByRole);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Set Password step
    expect(vault.exists()).toBe(false);

    await fireInput(asInput(getByPlaceholderText("Set password")), pwd);
    await fireInput(asInput(getByPlaceholderText("Confirm password")), pwd);

    expect(vault.exists()).toBe(false);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await vi.waitFor(() => {
      expect(vault.exists()).toBe(true);
    });

    // Network Syncing step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(settingsResetSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledWith(mnemonic, currentBlockHeight);

    await vi.waitFor(() => {
      expect(get(settingsStore).walletCreationBlockHeight).toBe(
        currentBlockHeight
      );
    });
    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    // The vault's one wallet, which keeps the data under the names of before.
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      currentBlockHeight,
      { key: expect.stringMatching(/^[0-9a-f]{32}$/), n: 1 }
    );
    expect(
      JSON.parse(
        localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`) ?? "{}"
      ).legacy
    ).toBe(clearAndInitSpy.mock.calls[0][2]?.key);

    // All Done step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith(
      "/dashboard/send/?to=someone&amount=0.011&network=testnet",
      { replaceState: true }
    );
  });
});
