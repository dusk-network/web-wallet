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
import vault from "$lib/vault";
import fixtures from "$lib/vault/__tests__/fixtures/login-v1.json";
import { useWalletData } from "$lib/wallets/walletData";

import UnlockWallet from "../+page.svelte";

const V1 = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login`;
const V2 = `${CONFIG.LOCAL_STORAGE_APP_KEY}-login-v2`;

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
  /** @type {HTMLInputElement} */ (
    container.querySelector("[type='password']")
  );

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
      expect(errorElement?.textContent).toMatch("Invalid recovery phrase");
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
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("Password workflow", () => {
    beforeAll(() => vault.setUp(mnemonic, pwd));

    afterAll(() => vault.clear());

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

      expect(openSpy).not.toHaveBeenCalled();
      expect(errorElement?.textContent).toMatch("Invalid password");
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
        expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
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
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
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
          expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
        } finally {
          await vault.setUp(mnemonic, pwd);
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
      expect(openSpy).not.toHaveBeenCalled();
      expect(gotoSpy).not.toHaveBeenCalled();
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
        expect(gotoSpy).toHaveBeenCalledWith("/dashboard");
      }
    );

    it("should move nothing with a wrong password", async () => {
      localStorage.setItem(V1, fixtures.legacy.stored);
      settingsStore.update(
        setUserId(await addressOf(fixtures.legacy.mnemonic))
      );

      await unlockWith(`${fixtures.legacy.password}!`);
      await vi.waitUntil(getErrorElement);

      expect(getErrorElement()?.textContent).toContain("Invalid password");
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
      expect(gotoSpy).toHaveBeenCalledWith("/dashboard");

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
