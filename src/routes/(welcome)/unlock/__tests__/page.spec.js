import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { ProfileGenerator } from "@dusk/w3sper";

import { getAsHTMLElement } from "$lib/dusk/test-helpers";
import {
  keptMigrations,
  rememberMigration,
} from "$lib/bridge/migrationActivity";
import * as navigation from "$lib/navigation";
import * as wallet from "$lib/wallet";
import { settingsStore, walletStore } from "$lib/stores";
import {
  generateMnemonic,
  getSeedFromMnemonic,
  profileGeneratorFrom,
} from "$lib/wallet";
import {
  fakeAuthenticator,
  removeFakeAuthenticator,
} from "$lib/test-helpers/fakeAuthenticator";
import vault from "$lib/vault";
import fixtures from "$lib/vault/__tests__/fixtures/login-v1.json";
import { noteActiveWallet } from "$lib/wallets/directory";
import { useWalletData } from "$lib/wallets/walletData";

import UnlockWallet from "../+page.svelte";

// The same IDs each run, for the snapshots.
vi.mock("$lib/dusk/string", async (importOriginal) => ({
  .../** @type {typeof import("$lib/dusk/string")} */ (await importOriginal()),
  randomUUID: () => "some-generated-id",
}));

const V1 = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
const V2 = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login-v2`;
const PASSKEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login-passkey`;

/** @param {string} key */
const stored = (key) => JSON.parse(localStorage.getItem(key) ?? "null");

/** @param {string} mnemonic */
const addressOf = (mnemonic) =>
  profileGeneratorFrom(getSeedFromMnemonic(mnemonic))
    .then((generator) => generator.default)
    .then(({ address }) => String(address));

const getKey = (/** @type {string} */ key) => (/** @type {any} */ value) =>
  value[key];
/** @type {(userId: string) => (settings: SettingsStoreContent) => SettingsStoreContent} */
const setUserId = (userId) => (settings) => ({ ...settings, userId });

/** @param {HTMLElement} container */
const getTextInput = (container) =>
  /** @type {HTMLInputElement} */ (container.querySelector("form input"));

describe("Unlock Wallet", async () => {
  const mnemonic = generateMnemonic();
  const pwd = "some pwd";
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

  // With a password, every wallet the vault opens is held, and one opens.
  const openSpy = vi.spyOn(walletStore, "open").mockResolvedValue(void 0);

  /** The wallets the password opened: the vault's, each by its ID. */
  const expectOpened = () =>
    expect(openSpy.mock.calls[0]?.[0]).toStrictEqual(
      (vault.list() ?? []).map(({ id, n }) => ({
        key: id,
        n,
        profileGenerator: expect.any(ProfileGenerator),
      }))
    );

  afterEach(async () => {
    cleanup();
    gotoSpy.mockClear();
    initSpy.mockClear();
    openSpy.mockClear();
    settingsStore.reset();
    walletStore.reset();
  });

  afterAll(async () => {
    gotoSpy.mockRestore();
    initSpy.mockRestore();
    openSpy.mockRestore();
  });

  describe("with fingerprint or face unlock on", () => {
    /** @type {ReturnType<typeof fakeAuthenticator>} */
    let device;

    /** @type {import("vitest").MockInstance} */
    let focus;

    beforeEach(async () => {
      localStorage.clear();
      sessionStorage.clear();
      device = fakeAuthenticator();
      focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
      await vault.setUp(mnemonic, pwd);
      await vault.addPasskey(device.passkey(), pwd);
      settingsStore.update(setUserId(userId));
    });

    afterEach(() => {
      cleanup();
      focus.mockRestore();
      removeFakeAuthenticator();
      localStorage.clear();
    });

    /** @param {import("@testing-library/svelte").RenderResult<any>} view */
    const fingerprint = (view) =>
      view.getByRole("button", { name: "Use fingerprint or face" });

    it("should go straight to it as the wallet opens, unlock what the password unlocks, and go where it left off", async () => {
      const place = vi
        .spyOn(navigation, "takePlace")
        .mockReturnValueOnce("/dashboard/send?to=abc");

      render(UnlockWallet);

      await waitForGoto();

      expect(device.get).toHaveBeenCalledOnce();
      expectOpened();
      expect(gotoSpy).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/send?to=abc",
        { replaceState: true }
      );
      place.mockRestore();
    });

    it("should say nothing of one turned down as it opens, leave the password to work, and ask again only as it's pressed", async () => {
      device.personAnswers("NotAllowedError");

      const view = render(UnlockWallet);

      await vi.waitFor(() => expect(device.get).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(fingerprint(view)).toBeEnabled());

      expect(view.queryByRole("alert")).toBeNull();
      expect(openSpy).not.toHaveBeenCalled();
      // Nothing brings a phone's keyboard up over the fingerprint.
      expect(getTextInput(view.container)).not.toHaveFocus();

      // The tab coming back doesn't ask again for what they turned down.
      document.dispatchEvent(new Event("visibilitychange"));

      expect(device.get).toHaveBeenCalledOnce();

      await fireEvent.click(fingerprint(view));
      await vi.waitFor(() => expect(device.get).toHaveBeenCalledTimes(2));

      // Asked for, and turned down: it says so, and the password's there.
      expect(await view.findByRole("alert")).toHaveTextContent(
        "That didn't unlock the wallet. Try again, or use your password."
      );
      expect(getTextInput(view.container)).not.toHaveFocus();

      await fireEvent.input(getTextInput(view.container), {
        target: { value: pwd },
      });
      await fireEvent.submit(getAsHTMLElement(view.container, "form"));
      await waitForGoto();

      expectOpened();
    });

    it("should work as ever by the password once the passkey is gone from the device, and lose nothing", async () => {
      device.forget();

      const view = render(UnlockWallet);

      await vi.waitFor(() => expect(fingerprint(view)).toBeEnabled());

      expect(vault.passkey()).not.toBeNull();

      await fireEvent.input(getTextInput(view.container), {
        target: { value: pwd },
      });
      await fireEvent.submit(getAsHTMLElement(view.container, "form"));
      await waitForGoto();

      expectOpened();
    });

    it("should leave it to be asked for right after a lock, and ask as the tab comes back", async () => {
      const locked = vi.spyOn(navigation, "lockedHere").mockReturnValue(true);
      const view = render(UnlockWallet);

      await vi.waitFor(() => expect(fingerprint(view)).toBeEnabled());

      expect(device.get).not.toHaveBeenCalled();

      document.dispatchEvent(new Event("visibilitychange"));

      await waitForGoto();

      expect(device.get).toHaveBeenCalledOnce();
      locked.mockRestore();
    });

    it("should never ask for a tab no one's looking at, and ask as they come to it", async () => {
      const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      const view = render(UnlockWallet);

      await vi.waitFor(() => expect(fingerprint(view)).toBeEnabled());

      expect(device.get).not.toHaveBeenCalled();

      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      await waitForGoto();
      visibility.mockRestore();
    });

    it("should say it's off when it opens nothing any more, and offer it no more", async () => {
      const stored = JSON.parse(
        /** @type {string} */ (localStorage.getItem(PASSKEY))
      );
      const other = device.passkey();

      // A record whose keys another passkey's PRF wrapped.
      localStorage.setItem(
        PASSKEY,
        JSON.stringify({
          ...stored,
          credentialId: other.credentialId,
          prfSalt: other.prfSalt,
        })
      );

      const view = render(UnlockWallet);

      expect(await view.findByRole("alert")).toHaveTextContent(
        "Fingerprint or face unlock is off now."
      );
      expect(
        view.queryByRole("button", { name: "Use fingerprint or face" })
      ).toBeNull();
      expect(vault.passkey()).toBeNull();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("should lead Back to the chooser, past going straight to it", async () => {
      device.personAnswers("NotAllowedError");

      const view = render(UnlockWallet);

      await vi.waitFor(() => expect(fingerprint(view)).toBeEnabled());

      expect(view.getByRole("link", { name: "Back" })).toHaveAttribute(
        "href",
        expect.stringMatching(/\/setup\?choose$/)
      );
    });
  });

  it("should offer no fingerprint without it turned on, and ask the device nothing", async () => {
    const device = fakeAuthenticator();

    localStorage.clear();
    await vault.setUp(mnemonic, pwd);

    const view = render(UnlockWallet);

    expect(
      view.queryByRole("button", { name: "Use fingerprint or face" })
    ).toBeNull();
    expect(device.get).not.toHaveBeenCalled();

    cleanup();
    removeFakeAuthenticator();
    localStorage.clear();
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
    it("should take the recovery phrase in Restore's word boxes, which browsers keep no record of, not in a password field they offer to save", () => {
      const { container, getAllByRole, getByRole } = render(UnlockWallet, {});
      const boxes = getAllByRole("textbox");

      expect(getByRole("group", { name: "Recovery phrase" })).toContainElement(
        boxes[0]
      );
      expect(boxes).toHaveLength(12);
      expect(getByRole("button", { name: "24 words" })).toBeInTheDocument();

      for (const box of boxes) {
        expect(box).toHaveAttribute("type", "text");
        expect(box).toHaveAttribute("autocomplete", "off");
        expect(box).toHaveAttribute("autocorrect", "off");
        expect(box).toHaveAttribute("autocapitalize", "none");
        expect(box).toHaveAttribute("spellcheck", "false");
      }

      expect(container.querySelector("input[type='password']")).toBeNull();
    });

    it("should unlock with the whole phrase pasted into any box", async () => {
      settingsStore.update(setUserId(userId));

      const { getByLabelText, getByRole } = render(UnlockWallet, {});
      const unlock = getByRole("button", { name: /unlock/i });

      expect(unlock).toBeDisabled();

      await fireEvent.paste(getByLabelText("Word 7"), {
        clipboardData: { getData: () => mnemonic },
      });
      await fireEvent.click(unlock);
      await waitForGoto();

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
        replaceState: true,
      });
    });

    it("should say when the words aren't a valid recovery phrase, and not unlock", async () => {
      settingsStore.update(setUserId(userId));

      const { container, getByLabelText, getByRole } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");

      // Twelve recovery words, though not a phrase: its last word is wrong.
      await fireEvent.paste(getByLabelText("Word 1"), {
        clipboardData: { getData: () => "abandon ".repeat(12) },
      });

      expect(getByRole("alert")).toHaveTextContent(
        "These words aren't a valid recovery phrase. Check each word."
      );
      expect(getByRole("button", { name: /unlock/i })).toBeDisabled();

      await fireEvent.submit(form, { currentTarget: form });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(initSpy).not.toHaveBeenCalled();
      expect(gotoSpy).not.toHaveBeenCalled();
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
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
        replaceState: true,
      });
    });

    it("should keep what the wallet records, though kept from before wallets had incarnations, once its phrase unlocks it", async () => {
      const migration = {
        amountLux: "1",
        createdAt: 1,
        hash: "0xab",
        recipient: "r",
        routeId: "bsc-to-dusk",
        sender: "s",
      };

      settingsStore.update(setUserId(userId));
      localStorage.removeItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-incarnation:`);

      // Its data opens as `init` opens it.
      initSpy.mockImplementationOnce(async () => useWalletData(""));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");

      await fireEvent.input(getTextInput(container), {
        target: { value: mnemonic },
      });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();
      rememberMigration(migration);

      expect(get(keptMigrations)).toMatchObject([migration]);
      expect(
        stored(`${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`)
      ).toMatchObject([migration]);
      localStorage.removeItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`);
    });

    it("should leave the wallet locked if the unlock is left as it waits for another tab", async () => {
      const name = `${CONFIG.LOCAL_STORAGE_APP_KEY}-incarnation:`;
      const holding = Promise.withResolvers();
      const free = Promise.withResolvers();
      // Another tab starts the wallet's incarnation meanwhile.
      const theirs = navigator.locks.request(name, async () => {
        holding.resolve(undefined);
        await free.promise;
      });

      settingsStore.update(setUserId(userId));
      localStorage.removeItem(name);
      await holding.promise;

      const { container, unmount } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");

      await fireEvent.input(getTextInput(container), {
        target: { value: mnemonic },
      });
      await fireEvent.submit(form, { currentTarget: form });
      await vi.waitUntil(
        async () => (await navigator.locks.query()).pending?.length,
        { timeout: 5_000 }
      );
      unmount();
      free.resolve(undefined);
      await theirs;
      // The unlock's turn comes and goes before this one's.
      await navigator.locks.request(
        name,
        () => new Promise((resolve) => setTimeout(resolve))
      );

      expect(localStorage.getItem(name)).not.toBeNull();
      expect(initSpy).not.toHaveBeenCalled();
      localStorage.removeItem(name);
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
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
        replaceState: true,
      });
    });
  });

  describe("Password workflow", () => {
    beforeAll(() => vault.setUp(mnemonic, pwd));

    afterAll(() => vault.clear());

    it("should show the password field and the link to restore the wallet if there is login info stored", () => {
      const { getByRole } = render(UnlockWallet, {});

      expect(getByRole("heading", { level: 2 })).toHaveTextContent(
        "Unlock your wallet"
      );
    });

    it("should take the password in a password field, as the current password", () => {
      const { container } = render(UnlockWallet, {});
      const field = getTextInput(container);

      expect(field).toHaveAttribute("type", "password");
      expect(field).toHaveAttribute("autocomplete", "current-password");
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

      expect(openSpy).not.toHaveBeenCalled();
      expect(errorElement).toHaveTextContent(
        "Wrong password. Forgot it? Restore with your recovery phrase."
      );
      expect(
        within(/** @type {HTMLElement} */ (errorElement)).getByRole("link", {
          name: "Restore with your recovery phrase",
        })
      ).toHaveAttribute("href", expect.stringMatching(/\/setup\/restore$/));
      expect(textInput).toHaveFocus();
      expect(selectedText).toBe(textInput.value);
    });

    /**
     * The settings name no wallet, or another one, as after a restore cut
     * short: the password opens the vault's wallets all the same.
     */
    it.each(["", "some-user-id"])(
      "should open the wallet the password opens, whichever wallet the settings name (%j)",
      async (currentUserID) => {
        settingsStore.update(setUserId(currentUserID));

        const { container } = render(UnlockWallet, {});
        const form = getAsHTMLElement(container, "form");
        const textInput = getTextInput(container);

        await fireEvent.input(textInput, { target: { value: pwd } });
        await fireEvent.submit(form, { currentTarget: form });
        await waitForGoto();

        expect(getErrorElement()).toBeNull();
        expect(openSpy).toHaveBeenCalledTimes(1);
        expectOpened();
        expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
          replaceState: true,
        });
      }
    );

    it("should unlock the Wallet is the entered password is for the last used mnemonic", async () => {
      settingsStore.update(setUserId(userId));

      const { container } = render(UnlockWallet, {});
      const form = getAsHTMLElement(container, "form");
      const textInput = getTextInput(container);

      await fireEvent.input(textInput, { target: { value: pwd } });
      await fireEvent.submit(form, { currentTarget: form });
      await waitForGoto();

      expect(get(settingsStore).userId).toBe(userId);
      expect(openSpy).toHaveBeenCalledTimes(1);
      expectOpened();
      expect(gotoSpy).toHaveBeenCalledTimes(1);
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
        replaceState: true,
      });
    });

    it.each([` ${pwd}`, `${pwd} `, `\t${pwd}\t`])(
      "should preserve password whitespace (case %#)",
      async (password) => {
        settingsStore.update(setUserId(userId));
        await vault.setUp(mnemonic, password);
        try {
          const { container } = render(UnlockWallet);
          await fireEvent.input(getTextInput(container), {
            target: { value: password },
          });
          await fireEvent.submit(getAsHTMLElement(container, "form"));
          await waitForGoto();
          expect(openSpy).toHaveBeenCalledTimes(1);
          expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
            replaceState: true,
          });
        } finally {
          await vault.setUp(mnemonic, pwd);
        }
      }
    );

    it("should say a wrong password anew on each try, for screen readers to announce it", async () => {
      settingsStore.update(setUserId(userId));
      const { container } = render(UnlockWallet);
      const form = getAsHTMLElement(container, "form");

      await fireEvent.input(getTextInput(container), {
        target: { value: "wrong" },
      });
      await fireEvent.submit(form);

      const first = await vi.waitUntil(getErrorElement);

      await fireEvent.input(getTextInput(container), {
        target: { value: "wrong again" },
      });
      await fireEvent.submit(form);

      expect(getErrorElement()).toBeNull();

      const second = await vi.waitUntil(getErrorElement);

      expect(second).not.toBe(first);
      expect(second).toHaveAttribute("role", "alert");
    });

    it("should not ignore extra whitespace added to a password", async () => {
      settingsStore.update(setUserId(userId));
      const { container } = render(UnlockWallet);
      await fireEvent.input(getTextInput(container), {
        target: { value: ` ${pwd} ` },
      });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
      await vi.waitUntil(getErrorElement);
      expect(getErrorElement()?.textContent).toContain("Wrong password.");
      expect(getErrorElement()).toHaveAttribute("role", "alert");
      expect(openSpy).not.toHaveBeenCalled();
      expect(gotoSpy).not.toHaveBeenCalled();
    });
  });

  describe("Keeping one's place", () => {
    beforeEach(async () => {
      await vault.setUp(mnemonic, pwd);
      settingsStore.update(setUserId(userId));
    });

    afterEach(async () => {
      await vault.clear();
    });

    /** Unlocks with the password. */
    const unlock = async () => {
      const { container } = render(UnlockWallet);

      await fireEvent.input(getTextInput(container), {
        target: { value: pwd },
      });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
      await waitForGoto();
    };

    it("should return to the page a lock, a reload or a link left off at, with its target", async () => {
      navigation.keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: "?to=alice.dusk",
      });

      await unlock();

      expect(gotoSpy).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/send/?to=alice.dusk",
        { replaceState: true }
      );
    });

    it("should open at Home once that page was returned to", async () => {
      navigation.keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: "",
      });

      await unlock();
      gotoSpy.mockClear();
      cleanup();
      await unlock();

      expect(gotoSpy).toHaveBeenCalledExactlyOnceWith("/dashboard", {
        replaceState: true,
      });
    });

    it("should open at Home for anything kept that isn't a page of the wallet", async () => {
      sessionStorage.setItem(
        `${CONFIG.LOCAL_STORAGE_APP_KEY}-place`,
        "//elsewhere.test/dashboard"
      );

      await unlock();

      expect(gotoSpy).toHaveBeenCalledExactlyOnceWith("/dashboard", {
        replaceState: true,
      });
    });

    it("should keep the place through a wrong password", async () => {
      navigation.keepPlace({
        pathname: "/some-base-path/dashboard/stake/",
        search: "?flow=native",
      });

      const { container } = render(UnlockWallet);
      const input = getTextInput(container);

      await fireEvent.input(input, { target: { value: "wrong" } });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
      await vi.waitUntil(() => getErrorElement(), { timeout: 5_000 });

      expect(gotoSpy).not.toHaveBeenCalled();

      await fireEvent.input(input, { target: { value: pwd } });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
      await waitForGoto();

      expect(gotoSpy).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/stake/?flow=native",
        { replaceState: true }
      );
    });

    it("should open the wallet on the profile it was on, and only that wallet", async () => {
      const [{ id }] = /** @type {Array<{ id: string }>} */ (vault.list());

      await noteActiveWallet(id, { accounts: [], addresses: [] });
      navigation.keepProfile(id, 1);

      await unlock();

      expect(openSpy.mock.calls[0][1]).toMatchObject({
        active: id,
        profile: 1,
      });

      cleanup();
      gotoSpy.mockClear();
      openSpy.mockClear();
      navigation.keepProfile("another wallet", 1);

      await unlock();

      expect(openSpy.mock.calls[0][1]).not.toHaveProperty("profile");
    });

    it("should keep no password or recovery phrase in this tab", async () => {
      navigation.keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: "",
      });

      await unlock();

      const tab = JSON.stringify({ ...sessionStorage });

      expect(tab).not.toContain(pwd);
      expect(tab).not.toContain(mnemonic.split(" ")[0]);
    });
  });

  describe("The move of the one recovery phrase earlier versions kept", () => {
    afterEach(async () => {
      await vault.clear();
      localStorage.removeItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`);
    });

    /** @param {string} password */
    async function unlockWith(password) {
      const { container } = render(UnlockWallet, {});

      await fireEvent.input(getTextInput(container), {
        target: { value: password },
      });
      await fireEvent.submit(getAsHTMLElement(container, "form"));
    }

    it.each([
      ["a current record", fixtures.current],
      ["a legacy record", fixtures.legacy],
    ])(
      "should move %s main kept into the vault as it unlocks",
      async (_name, fixture) => {
        localStorage.setItem(V1, fixture.stored);
        settingsStore.update(setUserId(await addressOf(fixture.mnemonic)));

        await unlockWith(fixture.password);
        await waitForGoto();

        expect(localStorage.getItem(V1)).toBeNull();
        expect(stored(V2).wallets).toEqual([
          expect.objectContaining({ id: expect.stringMatching(/^v1-/), n: 1 }),
        ]);

        expect(stored(V2).wallets[0]).toMatchObject(
          fixture === fixtures.current
            ? JSON.parse(fixture.stored)
            : { version: 1 }
        );
        expect(openSpy).toHaveBeenCalledTimes(1);
        expectOpened();
        expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
          replaceState: true,
        });
      }
    );

    it("should move nothing with a wrong password", async () => {
      localStorage.setItem(V1, fixtures.legacy.stored);
      settingsStore.update(
        setUserId(await addressOf(fixtures.legacy.mnemonic))
      );

      await unlockWith(`${fixtures.legacy.password}!`);
      await vi.waitUntil(getErrorElement);

      expect(getErrorElement()?.textContent).toContain("Wrong password.");
      expect(localStorage.getItem(V1)).toBe(fixtures.legacy.stored);
      expect(localStorage.getItem(V2)).toBeNull();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("should open a moved wallet the settings don't name with data of its own, the data kept before being another's", async () => {
      const migrations = `${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`;

      localStorage.setItem(V1, fixtures.legacy.stored);
      localStorage.setItem(migrations, "[]");
      settingsStore.update(setUserId("some-user-id"));

      await unlockWith(fixtures.legacy.password);
      await waitForGoto();

      const [moved] = vault.list() ?? [];

      expect(moved.id).toMatch(/^v1-/);
      expectOpened();
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard", {
        replaceState: true,
      });

      // The names of before are its own now, emptied of the other wallet's.
      expect(
        JSON.parse(
          localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`) ??
            "{}"
        ).legacy
      ).toBe(moved.id);
      expect(localStorage.getItem(migrations)).toBeNull();
    });

    it("should keep the data kept before for the moved wallet the settings name", async () => {
      const migrations = `${CONFIG.LOCAL_STORAGE_APP_KEY}-migrations`;

      localStorage.setItem(V1, fixtures.current.stored);
      localStorage.setItem(migrations, "[]");
      settingsStore.update(
        setUserId(await addressOf(fixtures.current.mnemonic))
      );

      await unlockWith(fixtures.current.password);
      await waitForGoto();

      expect(localStorage.getItem(migrations)).toBe("[]");
      localStorage.removeItem(migrations);
    });
  });
});
