import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
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
import loginInfoStorage from "$lib/services/loginInfoStorage";

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
    mockedWalletStore.getMockedStoreValue()
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

  it("should render the settings page displaying the status of the network", async () => {
    const { container } = render(Settings, {});

    expect(container.firstElementChild).toMatchSnapshot();

    await networkStore.disconnect();

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should label its controls without colons, and link the wallet's issues", async () => {
    const rendered = render(Settings, {});
    const { getByLabelText, getByRole, getByText } = rendered;

    await setCustomGas(rendered);

    expect(getByLabelText("Gas price (LUX)")).toBeInTheDocument();
    expect(getByLabelText("Gas limit")).toBeInTheDocument();
    expect(getByText("Currency")).toBeInTheDocument();
    expect(getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/dusk-network/web-wallet/issues"
    );
  });

  it("should open with the preferences, and keep gas under Advanced, folded", async () => {
    const rendered = render(Settings, {});
    const { container, getByRole, queryByRole } = rendered;
    const headings = Array.from(
      container.querySelectorAll(".settings-group__heading"),
      (heading) => heading.textContent?.trim()
    );
    const advanced = getByRole("button", { name: "Advanced" });

    expect(headings).toStrictEqual([
      "Preferences",
      "Advanced",
      "Support",
      "Reset wallet",
    ]);
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(queryByRole("switch", { name: "Custom gas" })).toBeNull();

    await openAdvanced(rendered);

    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(advanced).toHaveAttribute("aria-controls", "settings-advanced");
    expect(getByRole("switch", { name: "Custom gas" })).toBeInTheDocument();

    await fireEvent.click(advanced);

    expect(queryByRole("switch", { name: "Custom gas" })).toBeNull();
  });

  it("should show the wallet creation block height under Advanced if it's greater than zero", async () => {
    settingsStore.update((settings) => ({
      ...settings,
      walletCreationBlockHeight: 123n,
    }));

    const rendered = render(Settings, {});

    expect(rendered.queryByDisplayValue("123")).toBeNull();

    await openAdvanced(rendered);

    expect(rendered.getByDisplayValue("123")).toBeInTheDocument();
    expect(rendered.container.firstElementChild).toMatchSnapshot();

    settingsStore.reset();
  });

  it("should disable the reset wallet button while a sync is in progress", async () => {
    const { getByRole } = render(Settings);
    const resetButton = getByRole("button", { name: /reset wallet/i });

    expect(resetButton).not.toHaveAttribute("disabled");
    expect(resetButton).toHaveAttribute("data-tooltip-disabled", "true");

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
    expect(resetButton).toHaveAttribute("data-tooltip-disabled", "false");
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
    const { getByLabelText, getByRole, getByText, queryByLabelText } = rendered;

    await openAdvanced(rendered);

    const customGas = getByRole("switch", { name: "Custom gas" });
    const limitLabel = /^gas limit$/i;

    expect(customGas).toHaveAttribute("aria-checked", "false");
    expect(queryByLabelText(limitLabel)).toBeNull();
    expect(
      getByText(
        "The wallet uses the network's gas price, and a gas limit that suits each transaction."
      )
    ).toBeInTheDocument();
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
    const { getByLabelText, getByText, queryByText } = rendered;

    await setCustomGas(rendered);

    const limitInput = asInput(getByLabelText(/^gas limit$/i));

    expect(
      getByText("Each transaction costs at most 0.05 DUSK.")
    ).toBeInTheDocument();

    await fireInput(limitInput, "1500000");

    expect(getByText("The minimum is 2,000,000.")).toBeInTheDocument();
    expect(limitInput).toHaveAccessibleDescription("The minimum is 2,000,000.");
    expect(queryByText(/^Each transaction costs at most/)).toBeNull();

    await fireInput(limitInput, "3000000");

    expect(queryByText("The minimum is 2,000,000.")).toBeNull();
    expect(
      getByText("Each transaction costs at most 0.003 DUSK.")
    ).toBeInTheDocument();
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
      "true"
    );
    expect(asInput(getByLabelText(limitLabel)).value).toBe("70000000");
    expect(asInput(getByLabelText("Gas price (LUX)")).value).toBe("2");

    await act(() => settingsStore.resetGasSettings());

    expect(queryByLabelText(limitLabel)).toBeNull();
  });

  describe("Auto-lock", () => {
    const loginInfoSpy = vi.spyOn(loginInfoStorage, "get");

    afterEach(() => {
      loginInfoSpy.mockReset();
      settingsStore.reset();
    });

    afterAll(() => {
      loginInfoSpy.mockRestore();
    });

    it("should offer no auto-lock for a wallet without a password, which always locks", () => {
      loginInfoSpy.mockReturnValue(null);

      const { queryByLabelText } = render(Settings);

      expect(queryByLabelText("Lock when inactive")).toBeNull();
    });

    it("should let a wallet with a password lock after 5 or 15 minutes, 15 by default, or never", async () => {
      loginInfoSpy.mockReturnValue({
        data: new Uint8Array(),
        iv: new Uint8Array(),
        salt: new Uint8Array(),
      });

      const { getByLabelText } = render(Settings);
      const select = /** @type {HTMLSelectElement} */ (
        getByLabelText("Lock when inactive")
      );

      expect(Array.from(select.options, (option) => option.text)).toStrictEqual(
        ["After 5 minutes", "After 15 minutes", "Off"]
      );
      expect(select.value).toBe("15");

      await fireEvent.change(select, { target: { value: "5" } });

      expect(get(settingsStore).autoLockMinutes).toBe(5);

      await fireEvent.change(select, { target: { value: "0" } });

      expect(get(settingsStore).autoLockMinutes).toBe(0);
    });
  });

  it("should reset wallet store and navigate to landing page on clicking the Lock Wallet button", async () => {
    const { getByRole } = render(Settings);

    const button = getByRole("button", { name: "Lock Wallet" });

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
    const loginInfoStorageSpy = vi.spyOn(loginInfoStorage, "remove");

    beforeEach(() => {
      clearDataSpy.mockClear();
      confirmSpy.mockClear();
      settingsResetSpy.mockClear();
      loginInfoStorageSpy.mockClear();
    });

    afterAll(() => {
      clearDataSpy.mockRestore();
      confirmSpy.mockRestore();
      settingsResetSpy.mockRestore();
      loginInfoStorageSpy.mockRestore();
    });

    it("should clear local data, settings, and login info before logging out the user if the reset wallet button is clicked and the user confirms the operation", async () => {
      const { getByRole } = render(Settings);
      const resetButton = getByRole("button", { name: /reset wallet/i });

      await fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(clearDataSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersToNextTimerAsync();

      expect(loginInfoStorageSpy).toHaveBeenCalledTimes(1);
      expect(settingsResetSpy).toHaveBeenCalledTimes(1);
      expect(logoutSpy).toHaveBeenCalledTimes(1);
      expect(logoutSpy).toHaveBeenCalledWith(false);
    });

    it("should do nothing if the user doesn't confirm the reset", async () => {
      confirmSpy.mockReturnValueOnce(false);

      const { getByRole } = render(Settings);
      const resetButton = getByRole("button", { name: /reset wallet/i });

      await fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(clearDataSpy).not.toHaveBeenCalled();

      await vi.advanceTimersToNextTimerAsync();

      expect(loginInfoStorageSpy).not.toHaveBeenCalled();
      expect(settingsResetSpy).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
    });

    it("should show an error if clearing local data fails", async () => {
      clearDataSpy.mockRejectedValueOnce(new Error("Clear data error"));

      const { container, getByRole } = render(Settings);
      const resetButton = getByRole("button", { name: /reset wallet/i });

      await fireEvent.click(resetButton);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(clearDataSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersToNextTimerAsync();

      expect(settingsResetSpy).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(container.firstElementChild).toMatchSnapshot();
    });
  });
});
