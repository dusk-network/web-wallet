import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/svelte";
import { get } from "svelte/store";
import { PRICE_CURRENCIES } from "@dusk-network/app-core/amounts";
import { HIGHEST_DEFAULT_GAS_LIMIT } from "$lib/contracts/gasDefaults";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import * as navigation from "$lib/navigation";
import {
  gasPriceStore,
  gasStore,
  networkStore,
  settingsStore,
  walletStore,
} from "$lib/stores";
import vault from "$lib/vault";
import {
  sendPasswordLimit,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import { contactsWritten, listContacts, saveContact } from "$lib/contacts";
import { openTestContacts } from "$lib/test-helpers";

import Settings from "../+page.svelte";

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
 * Opens the Advanced section.
 *
 * @param {import("@testing-library/svelte").RenderResult<any>} rendered
 */
const openAdvanced = (rendered) =>
  fireEvent.click(rendered.getByRole("button", { name: "Advanced" }));

/**
 * Opens the Advanced section and turns custom gas on.
 *
 * @param {import("@testing-library/svelte").RenderResult<any>} rendered
 */
const setCustomGas = async (rendered) => {
  await openAdvanced(rendered);
  await fireEvent.click(rendered.getByRole("switch", { name: "Custom gas" }));
};

/**
 * The Advanced section, as its button says which it opens.
 *
 * @param {import("@testing-library/svelte").RenderResult<any>} rendered
 */
const advancedOf = (rendered) =>
  /** @type {HTMLElement} */ (
    document.getElementById(
      rendered
        .getByRole("button", { name: "Advanced" })
        .getAttribute("aria-controls") ?? "",
    )
  );

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {WalletStore} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      // @ts-ignore
      ...(await vi.importMock("$lib/stores/walletStore")).default,
      ...mockedWalletStore,
    },
  };
});

vi.useFakeTimers();

describe("Settings", () => {
  const initialWalletStoreState = structuredClone(
    mockedWalletStore.getMockedStoreValue(),
  );
  const logoutSpy = vi.spyOn(navigation, "logout");

  beforeEach(async () => {
    await networkStore.connect();
    mockedWalletStore.setMockedStoreValue(initialWalletStoreState);
  });

  afterEach(() => {
    cleanup();
    logoutSpy.mockClear();
    settingsStore.resetGasSettings();
  });

  afterAll(() => {
    logoutSpy.mockRestore();
    vi.doUnmock("$lib/stores");
  });

  it("should offer the currencies DUSK has a price in, the Swiss franc's by its code and the Georgian lari too, and no old bolívar", () => {
    const { container } = render(Settings, {});
    const offered = Array.from(
      container.querySelectorAll("select option"),
      (option) => /** @type {HTMLOptionElement} */ (option).value,
    ).filter((value) => /^[A-Z]{3}$/.test(value));

    expect(offered).toStrictEqual([...PRICE_CURRENCIES]);
    expect(offered).toEqual(expect.arrayContaining(["CHF", "GEL", "SGD"]));
    expect(offered).not.toEqual(expect.arrayContaining(["CFH"]));
    expect(offered).not.toEqual(expect.arrayContaining(["VEF"]));
  });

  it("should disable the reset wallet button while a sync is in progress", async () => {
    const { getByRole } = render(Settings);
    const resetButton = getByRole("button", { name: /reset wallet/i });

    expect(resetButton).not.toHaveAttribute("disabled");

    await act(() => {
      mockedWalletStore.setMockedStoreValue({
        ...initialWalletStoreState,
        syncStatus: {
          ...initialWalletStoreState.syncStatus,
          isInProgress: true,
        },
      });
    });

    expect(resetButton).toHaveAttribute("disabled");
  });

  it('should disable the "Back" button if invalid gas limit or price are introduced, and keep them in view', async () => {
    const { gasLimitLower, gasLimitUpper, gasPriceLower } = get(gasStore);
    const rendered = render(Settings, {});
    const { getByLabelText, getByRole } = rendered;
    const backButton = getByRole("link", { name: /back/i });

    expect(backButton).toHaveAttribute("aria-disabled", "false");

    await setCustomGas(rendered);

    const priceInput = asInput(getByLabelText(/price/i));
    const advanced = getByRole("button", { name: "Advanced" });

    await fireInput(priceInput, String(gasPriceLower - 1n));
    expect(backButton).toHaveAttribute("aria-disabled", "true");

    await fireEvent.click(advanced);

    expect(advanced).toHaveAttribute("aria-expanded", "true");

    await fireInput(priceInput, gasPriceLower.toString());
    expect(backButton).toHaveAttribute("aria-disabled", "false");

    const limitInput = asInput(getByLabelText(/^gas limit$/i));

    await fireInput(limitInput, String(gasLimitLower - 1n));
    expect(backButton).toHaveAttribute("aria-disabled", "true");
    await fireInput(limitInput, gasLimitLower.toString());
    expect(backButton).toHaveAttribute("aria-disabled", "false");
    await fireInput(limitInput, String(gasLimitUpper + 1n));
    expect(backButton).toHaveAttribute("aria-disabled", "true");
    await fireInput(limitInput, gasLimitUpper.toString());
    expect(backButton).toHaveAttribute("aria-disabled", "false");
  });

  it("should leave the gas limit to each operation, and the price to the node, unless custom gas is set", async () => {
    const rendered = render(Settings);
    const { getByLabelText, getByRole, queryByLabelText } = rendered;

    await openAdvanced(rendered);

    const customGas = getByRole("switch", { name: "Custom gas" });
    const limitLabel = /^gas limit$/i;

    expect(customGas).toHaveAttribute("aria-checked", "false");
    expect(queryByLabelText(limitLabel)).toBeNull();
    expect(get(settingsStore).customGasLimit).toBeNull();
    expect(get(settingsStore).customGasPrice).toBeNull();

    await fireEvent.click(customGas);

    const limitInput = asInput(getByLabelText(limitLabel));
    const priceInput = asInput(getByLabelText("Gas price (LUX)"));

    expect(limitInput.value).toBe(HIGHEST_DEFAULT_GAS_LIMIT.toString());
    expect(priceInput.value).toBe(get(gasPriceStore).toString());
    expect(get(settingsStore).customGasLimit).toBe(HIGHEST_DEFAULT_GAS_LIMIT);
    expect(get(settingsStore).customGasPrice).toBe(get(gasPriceStore));

    await fireInput(limitInput, "3000000");
    await fireInput(priceInput, "2");

    expect(get(settingsStore).customGasLimit).toBe(3_000_000n);
    expect(get(settingsStore).customGasPrice).toBe(2n);

    await fireEvent.click(customGas);

    expect(queryByLabelText(limitLabel)).toBeNull();
    expect(get(settingsStore).customGasLimit).toBeNull();
    expect(get(settingsStore).customGasPrice).toBeNull();
  });

  it("should say what custom gas costs at most in DUSK, and warn under the minimum gas limit while it is typed", async () => {
    const rendered = render(Settings);
    const { getByLabelText } = rendered;

    await setCustomGas(rendered);

    const limitInput = asInput(getByLabelText(/^gas limit$/i));
    /** The one cost Advanced says, if it says one. */
    const costSaid = () => within(advancedOf(rendered)).queryByText(/\d DUSK/);

    // The highest default limit at the network's price.
    expect(costSaid()).toHaveTextContent(/(?<![\d.,])0\.05 DUSK\b/);

    await fireInput(limitInput, "1500000");

    // The minimum said under the limit, and no cost for it.
    expect(limitInput).toHaveAttribute("aria-invalid", "true");
    expect(limitInput).toHaveAccessibleDescription(
      /(?<![\d.,])2,000,000(?![\d]|[.,]\d)/,
    );
    expect(costSaid()).toBeNull();

    await fireInput(limitInput, "3000000");

    expect(limitInput).toHaveAttribute("aria-invalid", "false");
    expect(limitInput).not.toHaveAccessibleDescription();
    expect(costSaid()).toHaveTextContent(/(?<![\d.,])0\.003 DUSK\b/);
  });

  it("should warn of custom gas far above the network's price, where it's set", async () => {
    const rendered = render(Settings);
    const { getByLabelText, queryByRole } = rendered;

    await setCustomGas(rendered);

    const priceInput = asInput(getByLabelText(/^gas price/i));
    /** The high-fee warning under custom gas, if it shows. */
    const highFee = () =>
      within(advancedOf(rendered)).queryByText(/^High fee\b/);

    // At the network's price, as custom gas starts: no warning.
    expect(highFee()).toBeNull();

    await fireInput(priceInput, "3");

    expect(highFee()).toHaveAttribute("role", "status");
    expect(highFee()).toHaveTextContent(/(?<![\d.,])3 times\b/);

    await fireInput(priceInput, "1");

    expect(highFee()).toBeNull();
    expect(queryByRole("status", { name: /high fee/i })).toBeNull();
  });

  it("should show stored custom gas until the gas settings are reset", async () => {
    settingsStore.update((settings) => ({
      ...settings,
      customGasLimit: 70_000_000n,
      customGasPrice: 2n,
    }));

    const rendered = render(Settings);
    const { getByLabelText, getByRole, queryByLabelText } = rendered;
    const limitLabel = /^gas limit$/i;

    await openAdvanced(rendered);

    expect(getByRole("switch", { name: "Custom gas" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(asInput(getByLabelText(limitLabel)).value).toBe("70000000");
    expect(asInput(getByLabelText("Gas price (LUX)")).value).toBe("2");

    await act(() => settingsStore.resetGasSettings());

    expect(queryByLabelText(limitLabel)).toBeNull();
  });

  describe("Auto-lock", () => {
    const hasVaultSpy = vi.spyOn(vault, "exists");

    afterEach(() => {
      hasVaultSpy.mockReset();
      settingsStore.reset();
    });

    afterAll(() => {
      hasVaultSpy.mockRestore();
    });

    it("should let a wallet with a password lock after 5 or 15 minutes, 15 by default, or never", async () => {
      hasVaultSpy.mockReturnValue(true);

      const { getByLabelText } = render(Settings);
      const select = /** @type {HTMLSelectElement} */ (
        getByLabelText("Lock when inactive")
      );

      expect(
        Array.from(select.options, (option) => option.value),
      ).toStrictEqual(["5", "15", "0"]);
      expect(select.value).toBe("15");

      await fireEvent.change(select, { target: { value: "5" } });

      expect(get(settingsStore).autoLockMinutes).toBe(5);

      await fireEvent.change(select, { target: { value: "0" } });

      expect(get(settingsStore).autoLockMinutes).toBe(0);
    });
  });

  it("should reset wallet store and navigate to landing page on clicking the Lock button", async () => {
    const { getByRole } = render(Settings);

    const button = getByRole("button", { name: "Lock" });

    await fireEvent.click(button);
    await vi.advanceTimersToNextTimerAsync();

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).toHaveBeenCalledWith(false);
  });

  describe("Resetting the wallet", () => {
    const clearDataSpy = vi
      .spyOn(walletStore, "clearLocalData")
      .mockResolvedValue(void 0);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const settingsResetSpy = vi.spyOn(settingsStore, "reset");
    const clearVaultSpy = vi.spyOn(vault, "clear");

    // The reset done: every wallet's data and phrase gone, then locked.
    const resetDone = () =>
      vi.waitFor(() => expect(logoutSpy).toHaveBeenCalled());

    beforeEach(() => {
      clearDataSpy.mockClear();
      confirmSpy.mockClear();
      settingsResetSpy.mockClear();
      clearVaultSpy.mockClear();
    });

    afterAll(() => {
      clearDataSpy.mockRestore();
      confirmSpy.mockRestore();
      settingsResetSpy.mockRestore();
      clearVaultSpy.mockRestore();
    });

    it("should clear local data, settings, and login info before logging out the user if the reset wallet button is clicked and the user confirms the operation", async () => {
      const { getByRole } = render(Settings);
      const resetButton = getByRole("button", { name: /reset wallet/i });

      await fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(clearDataSpy).toHaveBeenCalledTimes(1);

      await resetDone();

      expect(clearVaultSpy).toHaveBeenCalledTimes(1);
      expect(settingsResetSpy).toHaveBeenCalledTimes(1);
      expect(logoutSpy).toHaveBeenCalledTimes(1);
      expect(logoutSpy).toHaveBeenCalledWith(false);
    });

    it("should offer fingerprint or face unlock again afterwards, whatever the device showed before", async () => {
      const NO_PRF = `${CONFIG.LOCAL_STORAGE_APP_KEY}-passkey-no-prf`;

      localStorage.setItem(NO_PRF, String(Date.now()));

      const { getByRole } = render(Settings);

      await fireEvent.click(getByRole("button", { name: /reset wallet/i }));
      await resetDone();

      expect(localStorage.getItem(NO_PRF)).toBeNull();
    });

    it("should turn off the password on big sends, as the settings go", async () => {
      setSendPasswordLimit(1n);

      const { getByRole } = render(Settings);

      await fireEvent.click(getByRole("button", { name: /reset wallet/i }));
      await resetDone();

      expect(sendPasswordLimit()).toBeNull();
    });

    it("should keep no place or anything typed for what comes after", async () => {
      navigation.keepPlace({ pathname: "/dashboard/send/", search: "" });
      navigation.keepProfile("", 1);
      sessionStorage.setItem(
        `${CONFIG.LOCAL_STORAGE_APP_KEY}-draft-send`,
        JSON.stringify({ owner: "someone", values: { amount: "1" } }),
      );

      const { getByRole } = render(Settings);

      await fireEvent.click(getByRole("button", { name: /reset wallet/i }));
      await resetDone();
      await vi.waitFor(() => expect(navigation.takePlace()).toBeNull());

      expect(sessionStorage.length).toBe(0);
    });

    it("should delete the contacts of every wallet on this device, and those kept in plain text before", async () => {
      await openTestContacts();
      saveContact({ address: "some-address", name: "Alice (landlord)" });
      await contactsWritten();
      localStorage.setItem(
        `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`,
        JSON.stringify({ old: { address: "a", id: "old", name: "Old" } }),
      );

      const { getByRole } = render(Settings);

      await fireEvent.click(getByRole("button", { name: /reset wallet/i }));
      await resetDone();

      expect(listContacts()).toStrictEqual([]);
      expect(
        localStorage.getItem(
          `${CONFIG.LOCAL_STORAGE_APP_KEY}-encrypted-contacts`,
        ),
      ).toBeNull();
      expect(
        localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`),
      ).toBeNull();
      expect(
        Object.values(localStorage).filter((value) => value.includes("Old")),
      ).toStrictEqual([]);
    });

    it("should forget the EVM wallets connected here, so none comes back after it", async () => {
      localStorage.setItem("wagmi.store", JSON.stringify({ state: {} }));
      localStorage.setItem("@appkit/connection_status", "connected");

      const { getByRole } = render(Settings);

      await fireEvent.click(getByRole("button", { name: /reset wallet/i }));
      await resetDone();

      expect(logoutSpy).toHaveBeenCalledWith(false);
      expect(localStorage.getItem("wagmi.store")).toBeNull();
      expect(localStorage.getItem("@appkit/connection_status")).toBeNull();
    });

    it("should forget the bridge's transfers and times kept here", async () => {
      const kept = {
        [`${CONFIG.LOCAL_STORAGE_APP_KEY}-bridge-times-testnet-${"14".repeat(32)}`]:
          "{}",
        "dusk-evm:deposit-activity:v1": "[]",
        "dusk-evm:last-withdrawal-tx-hash": `0x${"44".repeat(32)}`,
        "dusk-evm:withdrawal-activity:v1": "[]",
      };

      for (const [key, value] of Object.entries(kept)) {
        localStorage.setItem(key, value);
      }

      const { getByRole } = render(Settings);

      await fireEvent.click(getByRole("button", { name: /reset wallet/i }));
      await resetDone();

      for (const key of Object.keys(kept)) {
        expect(localStorage.getItem(key)).toBeNull();
      }
    });

    it("should do nothing if the user doesn't confirm the reset", async () => {
      confirmSpy.mockReturnValueOnce(false);

      const { getByRole } = render(Settings);
      const resetButton = getByRole("button", { name: /reset wallet/i });

      await fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(clearDataSpy).not.toHaveBeenCalled();

      await vi.advanceTimersToNextTimerAsync();

      expect(clearVaultSpy).not.toHaveBeenCalled();
      expect(settingsResetSpy).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
    });

    it("should show an error if clearing local data fails", async () => {
      clearDataSpy.mockRejectedValueOnce(new Error("Clear data error"));

      const { getByRole } = render(Settings);
      const resetButton = getByRole("button", { name: /reset wallet/i });

      await fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(clearDataSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersToNextTimerAsync();

      expect(settingsResetSpy).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
    });
  });
});
