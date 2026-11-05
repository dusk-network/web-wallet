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
import { get } from "svelte/store";
import { ProfileGenerator } from "@dusk/w3sper";

import * as navigation from "$lib/navigation";
import * as routeHistory from "$lib/bridge/routeHistory";
import {
  sendPasswordFor,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import { settingsStore, walletStore } from "$lib/stores";
import vault from "$lib/vault";

import { load } from "../+layout";
import Layout from "../+layout.svelte";

describe("App layout.js", () => {
  const redirectSpy = vi.spyOn(navigation, "redirect");

  /**
   * What a page's load is given, as the address bar asks for it.
   *
   * @param {string} [path]
   */
  const asked = (path = "/some-base-path/dashboard/") =>
    /** @type {any} */ ({
      untrack: (/** @type {() => unknown} */ read) => read(),
      url: new URL(path, "https://wallet.test"),
    });

  afterEach(() => {
    redirectSpy.mockClear();
  });

  afterAll(() => {
    redirectSpy.mockRestore();
  });

  it("should check if a wallet is missing in the `walletStore` and redirect the user to the login page", async () => {
    await expect(load(asked())).rejects.toThrow();

    expect(redirectSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith(307, "/");
  });

  it("should keep the page asked for, with its target, for the unlock to return to", async () => {
    await expect(
      load(asked("/some-base-path/dashboard/send/?to=alice.dusk"))
    ).rejects.toThrow();

    expect(navigation.takePlace()).toBe("/dashboard/send/?to=alice.dusk");
    // Once.
    expect(navigation.takePlace()).toBeNull();
  });

  it("should do nothing otherwise", async () => {
    await walletStore.init(new ProfileGenerator(async () => new Uint8Array()));

    await expect(load(asked())).resolves.toBe(void 0);

    expect(redirectSpy).not.toHaveBeenCalled();
    expect(navigation.takePlace()).toBeNull();
  });
});

describe("App layout.svelte, on a wallet open", () => {
  afterEach(() => {
    cleanup();
    walletStore.reset();
  });

  it("should ask for the password on a big send over whatever shows, and stop asking once the wallet's pages are gone", async () => {
    const PHRASE =
      "scheme spot photo card baby mountain device kick cradle pact join borrow";

    await vault.setUp(PHRASE, "the password here");
    setSendPasswordLimit(0n);

    const { findByRole, queryByRole } = render(Layout);
    const asking = sendPasswordFor(1n, "");

    expect(
      await findByRole("dialog", { name: "Enter your password" })
    ).toBeInTheDocument();

    cleanup();

    await expect(asking).rejects.toThrow("The password wasn't given.");
    expect(queryByRole("dialog")).toBeNull();

    setSendPasswordLimit(null);
    await vault.clear();
  });

  it("should keep the profile the wallet is on, for an unlock to come back to", async () => {
    await walletStore.init(new ProfileGenerator(async () => new Uint8Array()));

    render(Layout);

    expect(navigation.keptProfile("")).toBe(0);

    const { profiles } = get(walletStore);

    await act(() => walletStore.setCurrentProfile(profiles[1]));

    expect(navigation.keptProfile("")).toBe(1);
    // Another wallet's isn't this one's.
    expect(navigation.keptProfile("another")).toBeUndefined();
  });
});

describe("App layout.svelte", () => {
  const logoutSpy = vi.spyOn(navigation, "logout").mockResolvedValue();
  const hasVaultSpy = vi.spyOn(vault, "exists");
  const minute = 60_000;

  /** @param {number} autoLockMinutes */
  const setAutoLock = (autoLockMinutes) =>
    settingsStore.update((settings) => ({ ...settings, autoLockMinutes }));

  /** A password is set, as the vault holds the phrase. */
  const setPassword = () => hasVaultSpy.mockReturnValue(true);

  beforeEach(() => {
    walletStore.abortSync();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    walletStore.abortSync();
    vi.useRealTimers();
    logoutSpy.mockClear();
    hasVaultSpy.mockReset();
    settingsStore.reset();
  });

  afterAll(() => {
    logoutSpy.mockRestore();
    hasVaultSpy.mockRestore();
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
