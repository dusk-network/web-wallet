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
    "cart dad sail wreck robot grit combine noble rap farm slide sad";
  const mnemonicShuffled = [
    "grit",
    "wreck",
    "cart",
    "dad",
    "rap",
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

    const { container } = render(Create, baseOptions);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should render the Terms of Service step of the Create flow if there is no userId saved in localStorage", () => {
    const { container } = render(Create, baseOptions);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should sum up the terms, with their own links to the Terms of Use and the Privacy Policy", () => {
    const { getByRole, getByText } = render(Create, baseOptions);

    expect(
      getByText(
        "Your keys stay in this browser, and only you hold them: Dusk can't recover them. The wallet has no analytics, and gets the DUSK price from CoinGecko."
      )
    ).toBeInTheDocument();
    expect(getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "https://dusk.network/terms-of-use/"
    );
    expect(getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "https://dusk.network/privacy-policy/"
    );
  });

  it("should call it the recovery phrase, and say how to check it", async () => {
    const { container, getByRole, getAllByRole, getByText } = render(
      Create,
      baseOptions
    );

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const agreementStep = container.textContent ?? "";

    expect(agreementStep).toMatch(/Keep it safe/);
    expect(agreementStep).toMatch(/my recovery phrase\./);
    expect(agreementStep).not.toMatch(/mnemonic/i);

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(
      getByText("Tap the words in the order you wrote them down.")
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/mnemonic/i);
  });

  it("should render the `Securely store your mnemonic phrase!` agreement step after the ToS", async () => {
    const { container, getByRole } = render(Create, baseOptions);

    const mathRandomSpy = vi.spyOn(Math, "random").mockReturnValue(42);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    expect(container.firstElementChild).toMatchSnapshot();

    mathRandomSpy.mockRestore();
  });

  it("should not allow the user proceed unless both agreement checks are selected on the `Securely store your mnemonic phrase!` step", async () => {
    const { getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const firstCheckbox = getAllByRole("checkbox")[0];
    const secondCheckbox = getAllByRole("checkbox")[1];
    const nextButton = getByRole("button", { name: "Next" });

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
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("correctly renders the Mnemonic Verification page", async () => {
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("doesn't let the user proceed if they have entered mismatching Mnemonic", async () => {
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const wordButtonsWrapper = container.getElementsByClassName(
      "dusk-mnemonic__validate-actions-wrapper"
    )[0];

    const wordButtons = Array.from(wordButtonsWrapper.children);

    wordButtons.forEach(async (button) => {
      await fireEvent.click(button);
    });

    await tick();

    expect(container.firstElementChild).toMatchSnapshot();

    expect(getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("lets the user proceed if they have entered a matching Mnemonic", async () => {
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

    await tick();

    expect(container.firstElementChild).toMatchSnapshot();

    expect(getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("ensures that the Undo button on the Mnemonic Validate step works as expected", async () => {
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

    await tick();

    await fireEvent.click(getByRole("button", { name: "Undo" }));

    expect(container.firstElementChild).toMatchSnapshot();

    expect(getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("ensures the Password step renders as expected", async () => {
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

    await tick();

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Password enabled
    expect(container.firstElementChild).toMatchSnapshot();

    await fireEvent.click(getByRole("switch"));

    // Password disabled
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("ensures the Network Syncing step renders as expected", async () => {
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(container.firstElementChild).toMatchSnapshot();
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

    for (const word of mnemonic.split(" ")) {
      await fireEvent.click(getByRole("button", { name: word }));
    }

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const advanced = /** @type {HTMLDetailsElement} */ (
      container.querySelector("details")
    );

    expect(
      getByText(
        "Next, the wallet syncs with the network. There is nothing to note."
      )
    ).toBeVisible();
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

    for (const word of mnemonic.split(" ")) {
      await fireEvent.click(getByRole("button", { name: word }));
    }

    await fireEvent.click(getByRole("button", { name: "Next" }));

    const password = getByPlaceholderText("Set Password");
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
    const { container, getByRole, getAllByRole } = render(Create, baseOptions);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    await fireEvent.click(getAllByRole("checkbox")[0]);
    await fireEvent.click(getAllByRole("checkbox")[1]);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(container.firstElementChild).toMatchSnapshot();

    /*
     * We wait for the `clearLocalDataAndInit` call inside `initializeWallet`
     * as the promise is not awaited and can happen after the test ends
     * invalidating the checks of other tests.
     */
    await vi.waitUntil(() => clearAndInitSpy.mock.calls.length === 1);
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
    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

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

    await vi.waitUntil(() => clearAndInitSpy.mock.calls.length === 1);

    expect(get(settingsStore).walletCreationBlockHeight).toBe(
      currentBlockHeight
    );
    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      currentBlockHeight
    );

    // All Done step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
  });

  it("should initialize the wallet encrypted mnemonic saved in localStorage", async () => {
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
    const mnemonicSplit = mnemonic.split(" ");

    mnemonicSplit.forEach(async (word) => {
      await fireEvent.click(getByRole("button", { name: word }));
    });

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Set Password step
    expect(vault.exists()).toBe(false);

    await fireInput(asInput(getByPlaceholderText("Set Password")), pwd);
    await fireInput(asInput(getByPlaceholderText("Confirm Password")), pwd);

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

    await vi.waitUntil(() => clearAndInitSpy.mock.calls.length === 1);

    expect(get(settingsStore).walletCreationBlockHeight).toBe(
      currentBlockHeight
    );
    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      currentBlockHeight
    );

    // All Done step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
  });
});
