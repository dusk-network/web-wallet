import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { settingsStore } from "$lib/stores";
import * as navigation from "$lib/navigation";
import { forgetArrivalTitle, transferEnded } from "$lib/bridge/arrivalNotice";

import MainLayout from "../+layout.svelte";

/** The page shown, which a test moves to another. */
const shown = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  shown.page = writable({ url: new URL("http://localhost/") });

  return { page: shown.page };
});

/** @param {string} path */
const showPage = (path) =>
  shown.page?.set({ url: new URL(`http://localhost/some-base-path${path}`) });

describe("Main layout", async () => {
  const isDarkMode = () => get(settingsStore).darkMode;
  const hasDarkClass = () =>
    document.documentElement.classList.contains("dark");

  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it.each([
    [
      "replacement",
      `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`,
      '{"userId":"other"}',
    ],
    ["reset", `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`, '{"userId":""}'],
    ["clear", null, null],
    ["invalid preferences", `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`, "{"],
  ])(
    "should invalidate all routes after a storage %s",
    async (_, key, newValue) => {
      const logout = vi.spyOn(navigation, "logout").mockResolvedValue();
      const reload = vi.fn();
      vi.stubGlobal("location", { reload });
      try {
        render(MainLayout);
        const event = {
          key,
          newValue,
          oldValue: '{"userId":"original"}',
          storageArea: localStorage,
        };
        await fireEvent(window, new StorageEvent("storage", event));
        await fireEvent(window, new StorageEvent("storage", event));
        expect(logout).toHaveBeenCalledTimes(1);
        expect(logout).toHaveBeenCalledWith(true);
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        logout.mockRestore();
        vi.unstubAllGlobals();
      }
    }
  );

  it.each(["success", "failure"])(
    "should reload after pending logout settles with %s",
    async (outcome) => {
      const pending = Promise.withResolvers();
      const logout = vi
        .spyOn(navigation, "logout")
        .mockReturnValue(pending.promise);
      const reload = vi.fn();
      vi.stubGlobal("location", { reload });
      try {
        render(MainLayout);
        const event = { key: null, storageArea: localStorage };
        await fireEvent(window, new StorageEvent("storage", event));
        await fireEvent(window, new StorageEvent("storage", event));
        expect(logout).toHaveBeenCalledTimes(1);
        expect(logout).toHaveBeenCalledWith(true);
        expect(reload).not.toHaveBeenCalled();
        if (outcome === "failure") {
          pending.reject(new Error("Logout navigation failed"));
        } else {
          pending.resolve(undefined);
        }
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      } finally {
        pending.resolve(undefined);
        logout.mockRestore();
        vi.unstubAllGlobals();
      }
    }
  );

  it.each([
    [
      `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`,
      '{"userId":"original","currency":"EUR"}',
      localStorage,
    ],
    ["unrelated", null, localStorage],
    [`${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`, null, sessionStorage],
  ])(
    "should ignore non-wallet storage changes (%s)",
    async (key, newValue, storageArea) => {
      const logout = vi.spyOn(navigation, "logout").mockResolvedValue();
      try {
        render(MainLayout);
        await fireEvent(
          window,
          new StorageEvent("storage", {
            key,
            newValue,
            oldValue: '{"userId":"original"}',
            storageArea,
          })
        );
        expect(logout).not.toHaveBeenCalled();
      } finally {
        logout.mockRestore();
      }
    }
  );

  it("should title the page of a payment request a link opened before a wallet is for the request, also while it connects, and the wallet's own as the wallet's", async () => {
    const TO =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";

    try {
      // Chen's and Amelie's: each link left a tab named as the wallet is.
      navigation.keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.05&memo=chicken+rice&network=testnet`,
      });
      showPage("/setup/");
      render(MainLayout);
      await vi.waitFor(() => expect(document.title).toBe("Payment request"));

      showPage("/unlock");
      await vi.waitFor(() => expect(document.title).toBe("Payment request"));

      // Making a wallet to pay it, and the wallet's own pages once it's open.
      showPage("/setup/create");
      await vi.waitFor(() => expect(document.title).toBe("Dusk Wallet"));

      navigation.takePlace();
      showPage("/dashboard/send");
      await vi.waitFor(() => expect(document.title).toBe("Send · Dusk Wallet"));

      // A page kept that asks for no payment.
      navigation.keepPlace({
        pathname: "/some-base-path/dashboard/stake/",
        search: "",
      });
      showPage("/unlock");
      await vi.waitFor(() => expect(document.title).toBe("Dusk Wallet"));
    } finally {
      navigation.forgetPlace();
      showPage("/");
    }
  });

  it("should say what ended first in the tab's title, for whoever is away, and its own again after", async () => {
    render(MainLayout);

    const own = document.title;

    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    transferEnded({ id: "a", title: "2 DUSK arrived on BSC" });
    await vi.waitFor(() =>
      expect(document.title).toBe(`2 DUSK arrived on BSC · ${own}`)
    );

    forgetArrivalTitle();
    await vi.waitFor(() => expect(document.title).toBe(own));
    vi.restoreAllMocks();
  });

  it('should add and remove the "dark" class name to the `html` element when the `darkMode` value changes in thesettings store', () => {
    expect(isDarkMode()).toBe(false);
    expect(hasDarkClass()).toBe(false);

    settingsStore.update((store) => ({ ...store, darkMode: true }));

    expect(isDarkMode()).toBe(true);
    expect(hasDarkClass()).toBe(true);

    settingsStore.reset();

    expect(isDarkMode()).toBe(false);
    expect(hasDarkClass()).toBe(false);
  });

  it("opens what a notification pressed says arrived on any page, as one locked since, where the unlock goes on to it", async () => {
    const events = new EventTarget();
    const goto = vi.spyOn(navigation, "goto").mockResolvedValue();

    // A browser with the wallet's service worker, which tells the page.
    vi.stubGlobal(
      "ServiceWorkerRegistration",
      class {
        async showNotification() {}
      }
    );
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
      },
    });

    try {
      render(MainLayout);
      events.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "arrival-open",
            url: `${location.origin}/some-base-path/dashboard/bridge/transactions?tx=ab`,
          },
        })
      );

      expect(goto).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/bridge/transactions?tx=ab"
      );
    } finally {
      cleanup();
      goto.mockRestore();
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });
});
