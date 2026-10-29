import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render } from "@testing-library/svelte";
import { ProfileGenerator } from "@dusk/w3sper";

import * as navigation from "$lib/navigation";
import * as routeHistory from "$lib/bridge/routeHistory";
import loginInfoStorage from "$lib/services/loginInfoStorage";
import { settingsStore, walletStore } from "$lib/stores";

import { load } from "../+layout";
import Layout from "../+layout.svelte";

describe("App layout.js", () => {
  const redirectSpy = vi.spyOn(navigation, "redirect");

  afterEach(() => {
    redirectSpy.mockClear();
  });

  afterAll(() => {
    redirectSpy.mockRestore();
  });

  it("should check if a wallet is missing in the `walletStore` and redirect the user to the login page", async () => {
    // @ts-ignore
    await expect(load()).rejects.toThrow();

    expect(redirectSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith(307, "/");
  });

  it("should do nothing otherwise", async () => {
    await walletStore.init(new ProfileGenerator(async () => new Uint8Array()));

    // @ts-ignore
    await expect(load()).resolves.toBe(void 0);

    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

describe("App layout.svelte", () => {
  const logoutSpy = vi.spyOn(navigation, "logout").mockResolvedValue();
  const loginInfoSpy = vi.spyOn(loginInfoStorage, "get");
  const minute = 60_000;

  /** @param {number} autoLockMinutes */
  const setAutoLock = (autoLockMinutes) =>
    settingsStore.update((settings) => ({ ...settings, autoLockMinutes }));

  /** A password is set, as a login record is stored. */
  const setPassword = () =>
    loginInfoSpy.mockReturnValue({
      data: new Uint8Array(),
      iv: new Uint8Array(),
      salt: new Uint8Array(),
    });

  beforeEach(() => {
    walletStore.abortSync();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    walletStore.abortSync();
    vi.useRealTimers();
    logoutSpy.mockClear();
    loginInfoSpy.mockReset();
    settingsStore.reset();
  });

  afterAll(() => {
    logoutSpy.mockRestore();
    loginInfoSpy.mockRestore();
  });

  it("should follow the history for the transfers to and from other chains while the wallet is open", () => {
    const stop = vi.fn();
    const followSpy = vi
      .spyOn(routeHistory, "followRouteHistory")
      .mockReturnValue(stop);

    render(Layout);

    expect(followSpy).toHaveBeenCalledOnce();

    cleanup();

    expect(stop).toHaveBeenCalledOnce();
    followSpy.mockRestore();
  });

  it("should logout the user after fifteen minutes without activity", async () => {
    render(Layout);

    await vi.advanceTimersByTimeAsync(navigation.INACTIVITY_TIMEOUT);

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).toHaveBeenCalledWith(false);
  });

  it("should lock a wallet without a password after fifteen minutes, whatever the setting", async () => {
    setAutoLock(0);
    render(Layout);

    await vi.advanceTimersByTimeAsync(15 * minute - 1);
    expect(logoutSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(logoutSpy).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("should lock a wallet with a password after the minutes set", async () => {
    setPassword();
    setAutoLock(5);
    render(Layout);

    await vi.advanceTimersByTimeAsync(5 * minute - 1);
    expect(logoutSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(logoutSpy).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("should never lock a wallet with a password when auto-lock is off", async () => {
    setPassword();
    setAutoLock(0);
    render(Layout);

    await vi.advanceTimersByTimeAsync(24 * 60 * minute);

    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it("should start over from a new auto-lock time, and only from a new one", async () => {
    setPassword();
    render(Layout);

    await vi.advanceTimersByTimeAsync(10 * minute);
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, hideBalances: true }))
    );
    await vi.advanceTimersByTimeAsync(5 * minute);

    expect(logoutSpy).toHaveBeenCalledTimes(1);

    logoutSpy.mockClear();
    await act(() => setAutoLock(5));
    await vi.advanceTimersByTimeAsync(5 * minute - 1);
    expect(logoutSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });
});
