import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { ProfileGenerator } from "@dusk/w3sper";

import * as navigation from "$lib/navigation";
import {
  mnemonicPhraseResetStore,
  settingsStore,
  walletStore,
} from "$lib/stores";
import * as walletLib from "$lib/wallet";
import vault from "$lib/vault";

import Restore from "../+page.svelte";

// The same IDs each run, for the snapshots.
vi.mock("$lib/dusk/string", async (importOriginal) => ({
  .../** @type {typeof import("$lib/dusk/string")} */ (await importOriginal()),
  randomUUID: () => "some-generated-id",
}));

const getKey = (/** @type {string} */ key) => (/** @type {any} */ value) =>
  value[key];
/** @type {(userId: string) => (settings: SettingsStoreContent) => SettingsStoreContent} */
const setUserId = (userId) => (settings) => ({ ...settings, userId });

/**
 * @param {HTMLElement} input
 * @param {*} value
 * @returns {Promise<boolean>}
 */
const fireInput = (input, value) =>
  fireEvent.input(input, { target: { value } });

/** @param {HTMLElement} element */
const asInput = (element) => /** @type {HTMLInputElement} */ (element);

/**
 * Pastes text into a word box, as a person does.
 *
 * @param {HTMLElement} box
 * @param {string} text
 */
const pasteInto = (box, text) =>
  fireEvent.paste(box, { clipboardData: { getData: () => text } });

describe("Restore", async () => {
  const mnemonic = walletLib.generateMnemonic();
  const invalidMnemonic = "dad dad dad dad dad dad dad dad dad dad dad dad";
  const pwd = "passwordpassword";
  const seed = walletLib.getSeedFromMnemonic(mnemonic);
  const userId = await walletLib
    .profileGeneratorFrom(seed)
    .then(getKey("default"))
    .then(getKey("address"))
    .then(String);
  const gotoSpy = vi.spyOn(navigation, "goto");
  const settingsResetSpy = vi.spyOn(settingsStore, "reset");
  const clearAndInitSpy = vi
    .spyOn(walletStore, "clearLocalDataAndInit")
    .mockResolvedValue(undefined);
  const initWalletSpy = vi.spyOn(walletLib, "initializeWallet");

  afterEach(async () => {
    cleanup();
    clearAndInitSpy.mockClear();
    gotoSpy.mockClear();
    settingsStore.reset();
    settingsResetSpy.mockClear();
    initWalletSpy.mockClear();
    walletStore.reset();
  });

  afterAll(() => {
    clearAndInitSpy.mockRestore();
    gotoSpy.mockRestore();
    settingsResetSpy.mockRestore();
    initWalletSpy.mockRestore();
  });

  it("should render the Existing Wallet notice step of the Restore flow if there is a userId saved in localStorage", () => {
    settingsStore.update(setUserId(userId));

    const { container } = render(Restore);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should render the Terms of Service step of the Restore flow if there is no userId saved in localStorage", () => {
    const { container } = render(Restore);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should render the Mnemonic Authenticate step after accepting the Existing Wallet Notice and the Terms of Service", async () => {
    settingsStore.update(setUserId(userId));

    const { container, getByRole } = render(Restore);

    await fireEvent.click(getByRole("button", { name: "Proceed" }));
    await fireEvent.click(getByRole("button", { name: "Accept" }));

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should allow the user to proceed to password setup after a valid mnemonic has been pasted into any box", async () => {
    const { getByLabelText, getByRole } = render(Restore);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const nextButton = getByRole("button", { name: "Next" });

    expect(nextButton).toBeDisabled();

    // Pasted into box 5: the words fill the boxes from the first.
    await pasteInto(getByLabelText("Word 5"), mnemonic);
    await tick();

    expect(asInput(getByLabelText("Word 1")).value).toBe(
      mnemonic.split(" ")[0]
    );
    expect(nextButton).not.toBeDisabled();
  });

  it("should keep the mnemonic editable when returning from password setup", async () => {
    const { getByLabelText, getByRole } = render(Restore);

    await fireEvent.click(getByRole("button", { name: "Accept" }));
    await pasteInto(getByLabelText("Word 1"), mnemonic);
    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.click(getByRole("button", { name: "Back" }));

    expect(asInput(getByLabelText("Word 12")).value).toBe(
      mnemonic.split(" ")[11]
    );
    expect(getByRole("button", { name: "Next" })).toBeEnabled();

    await fireInput(getByLabelText("Word 12"), "");

    expect(getByRole("button", { name: "Next" })).toBeDisabled();

    await pasteInto(getByLabelText("Word 3"), mnemonic);

    expect(getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("should say what's wrong with an invalid mnemonic as it's pasted, and not allow the user to proceed", async () => {
    const { getByLabelText, getByRole } = render(Restore);

    await fireEvent.click(getByRole("button", { name: "Accept" }));

    const nextButton = getByRole("button", { name: "Next" });

    await pasteInto(getByLabelText("Word 1"), invalidMnemonic);
    await tick();

    expect(getByRole("alert")).toHaveTextContent(
      "That isn't a valid recovery phrase. Check each word."
    );
    expect(nextButton).toBeDisabled();
  });

  it("should initialize the wallet without setting a password", async () => {
    await vault.setUp(mnemonic, pwd);

    const { getByLabelText, getByRole } = render(Restore);

    // ToS step
    await fireEvent.click(getByRole("button", { name: "Accept" }));

    // Mnemonic Authenticate step
    const nextButton = getByRole("button", { name: "Next" });

    expect(nextButton).toBeDisabled();

    await pasteInto(getByLabelText("Word 1"), mnemonic);

    expect(nextButton).toBeEnabled();
    await fireEvent.click(nextButton);

    // Set Password step
    await fireEvent.click(getByRole("switch"));

    await fireEvent.click(getByRole("button", { name: "Next" }));
    expect(vault.exists()).toBe(false);

    // Block Height Step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(settingsResetSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledWith(mnemonic, 0n);

    await vi.waitUntil(() => clearAndInitSpy.mock.calls.length === 1);

    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      0n,
      { key: "", n: 1 }
    );

    // Syncing Step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    // All Done Step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
  });

  it("should initialize the wallet with the encrypted mnemonic saved in localStorage", async () => {
    const { getByLabelText, getByPlaceholderText, getByRole } = render(Restore);

    // ToS step
    await fireEvent.click(getByRole("button", { name: "Accept" }));

    // Mnemonic Authenticate step
    const nextButton = getByRole("button", { name: "Next" });

    expect(nextButton).toBeDisabled();

    await pasteInto(getByLabelText("Word 1"), mnemonic);
    await tick();
    expect(nextButton).toBeEnabled();
    await fireEvent.click(nextButton);

    // Set Password step
    expect(vault.exists()).toBe(false);

    await fireInput(asInput(getByPlaceholderText("Set Password")), pwd);
    await fireInput(asInput(getByPlaceholderText("Confirm Password")), pwd);

    expect(vault.exists()).toBe(false);

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await vi.waitFor(() => {
      expect(vault.exists()).toBe(true);
    });

    // Block Height step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    expect(settingsResetSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledTimes(1);
    expect(initWalletSpy).toHaveBeenCalledWith(mnemonic, 0n);

    await vi.waitUntil(() => clearAndInitSpy.mock.calls.length === 1);

    expect(clearAndInitSpy).toHaveBeenCalledTimes(1);
    // The vault's one wallet, which keeps the data under the names of before.
    expect(clearAndInitSpy).toHaveBeenCalledWith(
      expect.any(ProfileGenerator),
      0n,
      { key: expect.stringMatching(/^[0-9a-f]{32}$/), n: 1 }
    );
    expect(
      JSON.parse(
        localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`) ?? "{}"
      ).legacy
    ).toBe(clearAndInitSpy.mock.calls[0][2]?.key);

    // Network Sync step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    // All Done step
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
  });

  it("should reset the Restore Mnemonic store on unmount", () => {
    const { unmount } = render(Restore);

    mnemonicPhraseResetStore.set([mnemonic]);

    unmount();

    expect(get(mnemonicPhraseResetStore)).toStrictEqual([]);
  });
});
