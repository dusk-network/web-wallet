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
        words[n - 1],
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
      getByRole("button", { name: "Remove and create" }),
    ).toBeInTheDocument();
  });

  it("should not allow the user proceed unless both agreement checks are selected on the `Securely store your mnemonic phrase!` step", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const firstCheckbox = getAllByRole("checkbox")[0];
    const secondCheckbox = getAllByRole("checkbox")[1];
    const nextButton = getByRole("button", { name: "Next" });

    expect(nextButton).toBeDisabled();

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

  // Persona round 41: nothing said to check that no one sees the screen
  // while the words show.
  it("says to make sure no one can see the screen in the backup text, above the words", async () => {
    const { container, getAllByRole, getByRole, getByText } = render(
      Create,
      baseOptions,
    );

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const backup = getByText(/no one can see your screen/i);
    const words = /** @type {HTMLElement} */ (
      container.querySelector(".dusk-words")
    );

    // In the text that says to write the phrase down, read before the words.
    expect(backup).toHaveTextContent(/write your phrase down/i);
    expect(backup.compareDocumentPosition(words)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  // Marek's, in Firefox for Android: the app switcher and the tab list kept
  // a picture of the words, as nothing hid them again.
  it("hides the words to write down the moment the page is hidden, and what's typed in their check, until Show words", async () => {
    const { container, getAllByRole, getByRole, queryByRole } = render(
      Create,
      baseOptions,
    );
    const words = mnemonic.split(" ");
    /** Which of the phrase's words are on the page, by their whole word. */
    const wordsShown = () =>
      words.filter((word) =>
        new RegExp(`\\b${word}\\b`).test(container.textContent ?? ""),
      );
    const shownWords = () =>
      Array.from(
        container.querySelectorAll(".dusk-words__word"),
        (word) => word.textContent?.trim() ?? "",
      );

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(shownWords()).toStrictEqual(words);

    // The window loses the focus, as the app switcher opens: hidden at once.
    window.dispatchEvent(new Event("blur"));
    await tick();

    expect(wordsShown()).toStrictEqual([]);

    // Back only as asked.
    await fireEvent.click(getByRole("button", { name: "Show words" }));

    expect(shownWords()).toStrictEqual(words);
    expect(queryByRole("button", { name: "Show words" })).toBeNull();

    // Their check: what's typed hidden as the page goes to the background.
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const boxes = container.querySelector(".recovery-check__words");

    for (const box of container.querySelectorAll(
      ".recovery-check__word input",
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
        baseOptions,
      );
      const words = mnemonic.split(" ");
      const shownWords = () =>
        Array.from(
          container.querySelectorAll(".dusk-words__word"),
          (word) => word.textContent?.trim() ?? "",
        );
      /** Which of the phrase's words are on the page, by their whole word. */
      const wordsShown = () =>
        words.filter((word) =>
          new RegExp(`\\b${word}\\b`).test(container.textContent ?? ""),
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

      await fireEvent.click(getByRole("button", { name: "Accept" }));
      await fireEvent.click(getAllByRole("checkbox")[0]);
      await fireEvent.click(getAllByRole("checkbox")[1]);
      await fireEvent.click(getByRole("button", { name: "Next" }));

      // At rest: none of them, though nothing left the page.
      expect(wordsShown()).toStrictEqual([]);
      expect(queryByRole("button", { name: "Show words" })).toBeNull();

      await finger("pointerdown");

      expect(shownWords()).toStrictEqual(words);

      await finger("pointerup");

      expect(wordsShown()).toStrictEqual([]);

      // Held as the phone leaves the page: masked at once.
      await finger("pointerdown");
      window.dispatchEvent(new Event("pagehide"));
      await tick();

      expect(wordsShown()).toStrictEqual([]);

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
    const { container, getAllByRole, getByRole, queryByRole } = render(
      Create,
      baseOptions,
    );

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
      (label) => Number(label.textContent?.replace(/\D/g, "")),
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

    const words = mnemonic.split(" ");

    /** Which of the phrase's words are on the page, by their whole word. */
    const wordsShown = () =>
      words.filter((word) =>
        new RegExp(`\\b${word}\\b`).test(container.textContent ?? ""),
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

      expect(getByRole("alert")).toBeInTheDocument();
      expect(wordsShown()).toStrictEqual([]);
      expect(container.querySelector(".dusk-words")).toBeNull();
      expect(boxesShown()).toStrictEqual([]);
      expect(getByRole("button", { name: "Skip for now" })).toBeEnabled();

      // Try again: the same three, empty.
      await fireEvent.click(getByRole("button", { name: "Try again" }));

      expect(
        Array.from(container.querySelectorAll(".recovery-check__word"), (l) =>
          Number(l.textContent?.replace(/\D/g, "")),
        ),
      ).toStrictEqual(asked);
      expect(boxesShown().map((box) => box.value)).toStrictEqual(["", "", ""]);
      expect(queryByRole("alert")).toBeNull();
    }

    // Right: they match, and Next goes on. Compared as both wallets compare
    // them: case, the spaces around and a keyboard's fullwidth letters aside.
    const fullwidth = (/** @type {string} */ word) =>
      word.replace(/[a-z]/gi, (letter) =>
        String.fromCharCode(letter.charCodeAt(0) + 0xfee0),
      );

    for (const [i, box] of boxesShown().entries()) {
      await fireInput(
        box,
        i === 1
          ? ` ${words[asked[1] - 1].toUpperCase()} `
          : i === 2
            ? fullwidth(words[asked[2] - 1])
            : words[asked[i] - 1],
      );
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));

    expect(getByRole("status")).toBeInTheDocument();
    expect(queryByRole("alert")).toBeNull();

    // On to the password.
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(container.querySelector("input[type=password]")).not.toBeNull();
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
        currentBlockHeight,
      );
    });
    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      currentBlockHeight,
      { key: "", n: 1 },
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
      () => /** @type {Promise<void>} */ (opening.promise),
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
      Promise.reject(new Error("some error")),
    );

    // Said, with the error, and no way on to the wallet.
    await vi.waitFor(() => {
      expect(failed.getByText(/some error/)).toBeInTheDocument();
    });
    expect(failed.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(gotoSpy).not.toHaveBeenCalled();
  });

  it("should initialize the wallet encrypted mnemonic saved in localStorage, and open the page a link asked for, as Send filled in by a request", async () => {
    // A payment link opened before there was a wallet.
    navigation.keepPlace({
      pathname: "/some-base-path/dashboard/send/",
      search: "?to=someone&amount=0.011&network=testnet",
    });

    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

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

    // Set Password step: the password, then its confirmation.
    expect(vault.exists()).toBe(false);

    for (const field of /** @type {NodeListOf<HTMLInputElement>} */ (
      container.querySelectorAll("input[type=password]")
    )) {
      await fireInput(field, pwd);
    }

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
        currentBlockHeight,
      );
    });
    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    // The vault's one wallet, which keeps the data under the names of before.
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      currentBlockHeight,
      { key: expect.stringMatching(/^[0-9a-f]{32}$/), n: 1 },
    );
    expect(
      JSON.parse(
        localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`) ?? "{}",
      ).legacy,
    ).toBe(clearAndInitSpy.mock.calls[0][2]?.key);

    // All Done step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith(
      "/dashboard/send/?to=someone&amount=0.011&network=testnet",
      { replaceState: true },
    );
  });
});
