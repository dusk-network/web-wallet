import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import * as navigation from "$lib/navigation";

import MainLayout from "../+layout.svelte";

describe("Main layout", async () => {
  afterEach(cleanup);

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
    },
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
    },
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
          }),
        );
        expect(logout).not.toHaveBeenCalled();
      } finally {
        logout.mockRestore();
      }
    },
  );
});
