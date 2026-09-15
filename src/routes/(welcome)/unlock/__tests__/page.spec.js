import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { ProfileGenerator } from "@dusk/w3sper";

import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import * as navigation from "$lib/navigation";
import * as wallet from "$lib/wallet";
import { settingsStore, walletStore } from "$lib/stores";
import {
  decryptMnemonic,
  encryptBuffer,
  encryptMnemonic,
  generateMnemonic,
  getSeedFromMnemonic,
  profileGeneratorFrom,
} from "$lib/wallet";
import loginInfoStorage from "$lib/services/loginInfoStorage";

import UnlockWallet from "../+page.svelte";

const getKey = (/** @type {string} */ key) => (/** @type {any} */ value) =>
  value[key];
/** @type {(userId: string) => (settings: SettingsStoreContent) => SettingsStoreContent} */
const setUserId = (userId) => (settings) => ({ ...settings, userId });

/** @param {HTMLElement} container */
const getTextInput = (container) =>
  /** @type {HTMLInputElement} */ (
    container.querySelector("[type='password']")
  );

describe("Unlock Wallet", async () => {
  const mnemonic = generateMnemonic();
  const pwd = "some pwd";
  const loginInfo = await encryptMnemonic(mnemonic, pwd);
  const legacyLoginInfo = await encryptBuffer(
    new TextEncoder().encode(mnemonic),
    pwd,
    10_000
  );
  const seed = getSeedFromMnemonic(mnemonic);
  const userId = await profileGeneratorFrom(seed)
    .then(getKey("default"))
    .then(getKey("address"))
    .then(String);

  const getErrorElement = () => document.querySelector(".banner--error");
  const gotoSpy = vi.spyOn(navigation, "goto");
  const waitForGoto = () =>
    vi.waitUntil(() => gotoSpy.mock.calls.length > 0, { timeout: 5_000 });

  /**
   * Sometimes a "DatabaseClosedError: Database has been closed" is
   * thrown when running this test (never happened running it in isolation).
   *
   * As I can't pinpoint what's causing it (all connections are opened before
   * db operations), I added the mocked implementation as here we don't care
   * about running `init` for real.
   */
  const initSpy = vi.spyOn(walletStore, "init").mockResolvedValue(void 0);

  afterEach(async () => {
    cleanup();
    gotoSpy.mockClear();
    initSpy.mockClear();
    settingsStore.reset();
    walletStore.reset();
  });

  afterAll(async () => {
    gotoSpy.mockRestore();
    initSpy.mockRestore();
  });

  it("should discard an unlock whose profile derivation finishes after leaving", async () => {
    settingsStore.update(setUserId(userId));
    const generator = await profileGeneratorFrom(seed);
    await generator.default;
    const pending = Promise.withResolvers();
    const derive = vi
      .spyOn(wallet, "profileGeneratorFrom")
      .mockReturnValueOnce(pending.promise);
    try {
      const { container, unmount } = render(UnlockWallet);
      await fireEvent.input(getTextInput(container), {
        target: { value: mnemonic },
      });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
      await vi.waitUntil(() => derive.mock.calls.length === 1);
      unmount();
      pending.resolve(generator);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).not.toHaveBeenCalled();
    } finally {
      pending.resolve(generator);
      derive.mockRestore();
    }
  });

  it("should cancel initialization on leaving and ignore duplicate submits", async () => {
    settingsStore.update(setUserId(userId));
    const pending = Promise.withResolvers();
    initSpy.mockReturnValueOnce(pending.promise);
    const reset = vi.spyOn(walletStore, "reset");
    try {
      const { container, unmount } = render(UnlockWallet);
      const form = getAsHTMLElement(container, "form");
      await fireEvent.input(getTextInput(container), {
        target: { value: mnemonic },
      });
      await fireEvent.submit(form);
      await vi.waitUntil(() => initSpy.mock.calls.length === 1);
      await fireEvent.submit(form);
      unmount();
      expect(reset).toHaveBeenCalledTimes(1);
      pending.resolve(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).not.toHaveBeenCalled();
    } finally {
      pending.resolve(undefined);
      reset.mockRestore();
    }
  });

  describe("Mnemonic phrase workflow", () => {
    it("should render the Unlock Wallet page and show the field to enter the mnemonic phrase, if there is no login info stored", () => {
      const { container } = render(UnlockWallet, {});

      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should show an error message if the user enters an invalid mnemonic", async () => {
      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      expect(getErrorElement()).toBeNull();

      await fireEvent.input(textInput, { target: { value: "foo bar" } });
      await fireEvent.submit(form, { currentTarget: form });

      const errorElement = await vi.waitUntil(getErrorElement);
      const selectedText = textInput.value.substring(
        Number(textInput.selectionStart),
        Number(textInput.selectionEnd)
      );

      expect(initSpy).not.toHaveBeenCalled();
      expect(errorElement?.textContent).toMatch("Invalid mnemonic phrase");
      expect(textInput).toHaveFocus();
      expect(selectedText).toBe(textInput.value);
    });

    it("should redirect to the Restore flow if the user inputs a valid mnemonic with no prior wallet created", async () => {
      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: mnemonic } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      expect(get(settingsStore).userId).toBe("");
      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).toHaveBeenCalledWith("/setup/restore");
    });

    it("should redirect to the Restore flow the user inputs a valid mnemonic different from the last one used", async () => {
      const currentUserID = "some-user-id";
      settingsStore.update(setUserId(currentUserID));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: mnemonic } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      expect(get(settingsStore).userId).toBe(currentUserID);
      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).toHaveBeenCalledWith("/setup/restore");
    });

    it("should unlock the Wallet if the entered mnemonic is the last one used", async () => {
      settingsStore.update(setUserId(userId));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: mnemonic } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      expect(get(settingsStore).userId).toBe(userId);
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(expect.any(ProfileGenerator));
      expect(gotoSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
    });

    it("should trim and lower case the entered mnemonic before validating it", async () => {
      settingsStore.update(setUserId(userId));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, {
        target: { value: `  \t${mnemonic.toUpperCase()} \t  ` },
      });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      expect(get(settingsStore).userId).toBe(userId);
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(expect.any(ProfileGenerator));
      expect(gotoSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("Password workflow", () => {
    beforeAll(() => loginInfoStorage.set(loginInfo));

    afterAll(() => loginInfoStorage.remove());

    it("should show the password field and the link to restore the wallet if there is login info stored", () => {
      const { container } = render(UnlockWallet, {});

      expect(container.firstElementChild).toMatchSnapshot();
    });

    it("should show an error message if the user enters the wrong password", async () => {
      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      expect(getErrorElement()).toBeNull();

      await fireEvent.input(textInput, { target: { value: "foo bar" } });
      await fireEvent.submit(form, { currentTarget: form });

      const errorElement = await vi.waitUntil(getErrorElement);
      const selectedText = textInput.value.substring(
        Number(textInput.selectionStart),
        Number(textInput.selectionEnd)
      );

      expect(initSpy).not.toHaveBeenCalled();
      expect(errorElement?.textContent).toMatch("Invalid password");
      expect(textInput).toHaveFocus();
      expect(selectedText).toBe(textInput.value);
    });

    /**
     * This is not a possible situation, in theory, but
     * the workflow is able to deal with it.
     */
    it("should redirect to the Restore flow if the user inputs the correct password with no prior wallet created", async () => {
      settingsStore.update(setUserId(""));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: pwd } });
      await fireEvent.submit(form, { currentTarget: form });

      expect(getErrorElement()).toBeNull();

      await waitForGoto();

      expect(getErrorElement()).toBeNull();
      expect(get(settingsStore).userId).toBe("");
      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/setup/restore");
    });

    /**
     * This is not a possible situation, in theory, but
     * the workflow is able to deal with it.
     */
    it("should redirect to the Restore flow if the user inputs the correct password for a mnemonic different from the last one used", async () => {
      const currentUserID = "some-user-id";

      settingsStore.update(setUserId(currentUserID));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: pwd } });
      await fireEvent.submit(form, { currentTarget: form });

      expect(getErrorElement()).toBeNull();

      await waitForGoto();

      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/setup/restore");
    });

    it("should unlock the Wallet is the entered password is for the last used mnemonic", async () => {
      settingsStore.update(setUserId(userId));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: pwd } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      expect(get(settingsStore).userId).toBe(userId);
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(expect.any(ProfileGenerator));
      expect(gotoSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
    });

    it.each([` ${pwd}`, `${pwd} `, `\t${pwd}\t`])(
      "should preserve password whitespace (case %#)",
      async (password) => {
        settingsStore.update(setUserId(userId));
        await loginInfoStorage.set(await encryptMnemonic(mnemonic, password));
        try {
          const { container } = render(UnlockWallet);
          await fireEvent.input(getTextInput(container), {
            target: { value: password },
          });
          await fireEvent.submit(getAsHTMLElement(container, "form"));
          await waitForGoto();
          expect(initSpy).toHaveBeenCalledTimes(1);
          expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
        } finally {
          await loginInfoStorage.set(loginInfo);
        }
      }
    );

    it("should not ignore extra whitespace added to a password", async () => {
      settingsStore.update(setUserId(userId));
      const { container } = render(UnlockWallet);
      await fireEvent.input(getTextInput(container), {
        target: { value: ` ${pwd} ` },
      });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
      await vi.waitUntil(getErrorElement);
      expect(getErrorElement()?.textContent).toContain("Invalid password");
      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).not.toHaveBeenCalled();
    });
  });

  describe("Legacy password migration", () => {
    afterEach(() => loginInfoStorage.remove());

    it("should migrate legacy login info after unlocking the expected wallet", async () => {
      await loginInfoStorage.set(legacyLoginInfo);
      settingsStore.update(setUserId(userId));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: pwd } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      const migratedLoginInfo = loginInfoStorage.get();

      expect(migratedLoginInfo).not.toBeNull();

      if (!migratedLoginInfo) {
        throw new Error("Expected migrated login info");
      }

      expect(migratedLoginInfo.version).toBe(1);
      expect(await decryptMnemonic(migratedLoginInfo, pwd)).toBe(mnemonic);
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
    });

    it("should preserve legacy login info if the wallet identity does not match", async () => {
      await loginInfoStorage.set(legacyLoginInfo);
      settingsStore.update(setUserId("some-user-id"));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: pwd } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      const storedLoginInfo = loginInfoStorage.get();

      expect(storedLoginInfo).not.toBeNull();

      if (!storedLoginInfo) {
        throw new Error("Expected stored login info");
      }

      for (const field of /** @type {const} */ (["data", "iv", "salt"])) {
        expect([...storedLoginInfo[field]]).toStrictEqual([
          ...legacyLoginInfo[field],
        ]);
      }
      expect(storedLoginInfo.version).toBeUndefined();
      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).toHaveBeenCalledWith("/setup/restore");
    });
  });
});
