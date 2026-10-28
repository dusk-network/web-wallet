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
import { get } from "svelte/store";

describe("Settings store", () => {
  const languageSpy = vi
    .spyOn(navigator, "language", "get")
    .mockReturnValue("it-IT");

  const originalMatchMedia = window.matchMedia;

  Object.defineProperty(window, "matchMedia", {
    /** @param {MediaQueryList} query */
    value: (query) => ({
      addEventListener: () => {},
      dispatchEvent: () => {},
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: () => {},
    }),
    writable: true,
  });

  /** @type {SettingsStore} */
  let settingsStore;

  /** @type {SettingsStoreContent} */
  let settingsStoreContent;

  /**
   * Function to serialize an object containing BigInt values.
   * Converts BigInt values to strings with an 'n' suffix.
   *
   * @type {(value: any) => string}
   */
  let serializeProperty;

  /**
   * Function to deserialize a JSON string with BigInt values in string format.
   * Converts strings with an 'n' suffix back to BigInt values.
   *
   * @type {(value: string) => any}
   */
  let deserializeProperty;

  beforeEach(async () => {
    vi.resetModules();
    const settingsStoreModule = await import("../settingsStore");
    settingsStore = settingsStoreModule.default;
    settingsStoreContent = get(settingsStore);
    serializeProperty = settingsStoreModule.serializeProperty;
    deserializeProperty = settingsStoreModule.deserializeProperty;
  });

  afterAll(() => {
    languageSpy.mockRestore();

    window.matchMedia = originalMatchMedia;
  });

  describe("In a browser environment", () => {
    beforeAll(() => {
      vi.doMock("$app/environment", async (importOriginal) => {
        /** @type {typeof import("$app/environment")} */
        const original = await importOriginal();

        return {
          ...original,
          browser: true,
        };
      });
    });

    afterEach(() => {
      localStorage.clear();
    });

    afterAll(() => {
      vi.doUnmock("$app/environment");
    });

    it("should get the browser's settings for dark mode and language and use them along the other defaults", async () => {
      expect(settingsStoreContent.language).toBe("it-IT");
      expect(settingsStoreContent.darkMode).toBe(true);
    });

    it("should persist its values in local storage", async () => {
      settingsStore.update((store) => ({
        ...store,
        darkMode: false,
      }));

      const localStorageSettings = JSON.parse(
        // @ts-expect-error
        localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`)
      );

      const expectedSettings = {
        ...settingsStoreContent,
        customGasLimit: null,
        customGasPrice: null,
        darkMode: false,
        gasLimit: `${settingsStoreContent.gasLimit}n`,
        gasPrice: `${settingsStoreContent.gasPrice}n`,
        walletCreationBlockHeight: "0n",
      };

      expect(localStorageSettings).toStrictEqual(expectedSettings);
    });

    it("should remember hidden balances, which are shown by default and again after a reset", async () => {
      expect(settingsStoreContent.hideBalances).toBe(false);

      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      vi.resetModules();

      const reloadedStore = (await import("../settingsStore")).default;

      expect(get(reloadedStore).hideBalances).toBe(true);

      reloadedStore.reset();

      expect(get(reloadedStore).hideBalances).toBe(false);
    });

    describe("Gas limit", () => {
      const key = `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`;

      /**
       * Stores settings as a version without a custom gas limit did.
       *
       * @param {bigint} gasLimit
       */
      const storeOldSettings = (gasLimit) =>
        localStorage.setItem(
          key,
          serializeProperty(
            Object.fromEntries(
              Object.entries({ ...settingsStoreContent, gasLimit }).filter(
                ([name]) => name !== "customGasLimit"
              )
            )
          )
        );

      const loadSettings = async () => {
        vi.resetModules();

        return get((await import("../settingsStore")).default);
      };

      it("should have no custom gas limit, and the old default one, by default", () => {
        expect(settingsStoreContent.customGasLimit).toBeNull();
        expect(settingsStoreContent.gasLimit).toBe(100_000_000n);
      });

      it("should not make the old default gas limit a custom one", async () => {
        storeOldSettings(100_000_000n);

        const settings = await loadSettings();

        expect(settings.customGasLimit).toBeNull();
        expect(settings.gasLimit).toBe(100_000_000n);
        expect(deserializeProperty(localStorage.getItem(key) ?? "")).toEqual(
          expect.objectContaining({
            customGasLimit: null,
            gasLimit: 100_000_000n,
          })
        );
      });

      it("should keep a gas limit the user chose as the custom one", async () => {
        storeOldSettings(200_000_000n);

        const settings = await loadSettings();

        expect(settings.customGasLimit).toBe(200_000_000n);
        expect(settings.gasLimit).toBe(200_000_000n);
      });

      it("should use the node's gas price, and lock after fifteen minutes, by default", () => {
        expect(settingsStoreContent.customGasPrice).toBeNull();
        expect(settingsStoreContent.autoLockMinutes).toBe(15);
      });

      it("should keep the gas price of stored settings with a custom gas limit as the custom one", async () => {
        localStorage.setItem(
          key,
          serializeProperty(
            Object.fromEntries(
              Object.entries({
                ...settingsStoreContent,
                customGasLimit: 70_000_000n,
                gasPrice: 2n,
              }).filter(([name]) => name !== "customGasPrice")
            )
          )
        );

        const settings = await loadSettings();

        expect(settings.customGasLimit).toBe(70_000_000n);
        expect(settings.customGasPrice).toBe(2n);
      });

      it("should use the node's gas price for stored settings without a custom gas limit", async () => {
        localStorage.setItem(
          key,
          serializeProperty(
            Object.fromEntries(
              Object.entries({
                ...settingsStoreContent,
                customGasLimit: null,
                gasPrice: 2n,
              }).filter(([name]) => name !== "customGasPrice")
            )
          )
        );

        expect((await loadSettings()).customGasPrice).toBeNull();
      });

      it.each([undefined, 1, 30, "15"])(
        "should lock after fifteen minutes for a stored auto-lock time of %s",
        async (autoLockMinutes) => {
          localStorage.setItem(
            key,
            serializeProperty({ ...settingsStoreContent, autoLockMinutes })
          );

          expect((await loadSettings()).autoLockMinutes).toBe(15);
        }
      );

      it.each([0, 5, 15])(
        "should keep a stored auto-lock time of %s",
        async (autoLockMinutes) => {
          localStorage.setItem(
            key,
            serializeProperty({ ...settingsStoreContent, autoLockMinutes })
          );

          expect((await loadSettings()).autoLockMinutes).toBe(autoLockMinutes);
        }
      );

      it("should keep a custom gas limit equal to the old default", async () => {
        localStorage.setItem(
          key,
          serializeProperty({
            ...settingsStoreContent,
            customGasLimit: 100_000_000n,
          })
        );

        expect((await loadSettings()).customGasLimit).toBe(100_000_000n);
      });
    });

    it("should expose a method to reset the store to its initial state", () => {
      const newState = {
        ...settingsStoreContent,
        darkMode: false,
        foo: "bar",
      };

      settingsStore.set(newState);

      expect(get(settingsStore)).toBe(newState);

      settingsStore.reset();

      expect(get(settingsStore)).toBe(settingsStoreContent);
    });

    it("should expose a method to reset the gas settings to their defaults", () => {
      const newStateWithoutGas = {
        autoLockMinutes: 5,
        currency: "FAKE CURRENCY",
        darkMode: !settingsStoreContent.darkMode,
        dashboardTransactionLimit:
          settingsStoreContent.dashboardTransactionLimit + 1,
        hideBalances: !settingsStoreContent.hideBalances,
        hideStakingNotice: !settingsStoreContent.hideStakingNotice,
        language: "FAKE LANGUAGE",
        userId: "FAKE USER ID",
        walletCreationBlockHeight: 123n,
      };
      const newState = {
        ...newStateWithoutGas,
        customGasLimit: 200_000_000n,
        customGasPrice: 3n,
        gasLimit: settingsStoreContent.gasLimit,
        gasPrice: settingsStoreContent.gasPrice * 15n,
      };
      const expectedState = {
        ...settingsStoreContent,
        ...newStateWithoutGas,
      };

      settingsStore.set(newState);

      expect(get(settingsStore)).toBe(newState);

      settingsStore.resetGasSettings();

      expect(get(settingsStore)).toStrictEqual(expectedState);
      expect(
        JSON.parse(
          // @ts-ignore
          localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`)
        )
      ).toStrictEqual({
        ...expectedState,
        customGasLimit: null,
        customGasPrice: null,
        gasLimit: `${expectedState.gasLimit}n`,
        gasPrice: `${expectedState.gasPrice}n`,
        walletCreationBlockHeight: "123n",
      });
    });
  });

  describe("In a non browser environment", () => {
    beforeAll(() => {
      vi.doMock("$app/environment", async (importOriginal) => {
        /** @type {typeof import("$app/environment")} */
        const original = await importOriginal();

        return {
          ...original,
          browser: false,
        };
      });
    });

    afterAll(() => {
      vi.doUnmock("$app/environment");
    });

    it("should use its own defaults in place of the browser's settings", () => {
      expect(settingsStoreContent).toMatchObject({
        darkMode: false,
        language: "en",
      });
    });
  });

  describe("BigInt serialization and deserialization", () => {
    it("should serialize BigInt values correctly", () => {
      const objWithBigInt = {
        gasLimit: BigInt(1000000000),
        gasPrice: BigInt(2000000000),
      };

      const serialized = serializeProperty(objWithBigInt);

      const expectedSerialized = JSON.stringify({
        gasLimit: "1000000000n",
        gasPrice: "2000000000n",
      });

      expect(serialized).toBe(expectedSerialized);
    });

    it("should deserialize BigInt values correctly", () => {
      const serialized = JSON.stringify({
        gasLimit: "1000000000n",
        gasPrice: "2000000000n",
      });

      const deserialized = deserializeProperty(serialized);

      const expectedDeserialized = {
        gasLimit: BigInt(1000000000),
        gasPrice: BigInt(2000000000),
      };

      expect(deserialized).toStrictEqual(expectedDeserialized);
    });
  });
});
