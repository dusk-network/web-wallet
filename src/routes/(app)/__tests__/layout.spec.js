import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { ProfileGenerator } from "@dusk/w3sper";

import * as navigation from "$lib/navigation";
import { walletStore } from "$lib/stores";

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

  afterEach(() => {
    cleanup();
    logoutSpy.mockClear();
  });

  afterAll(() => {
    logoutSpy.mockRestore();
  });

  it("should logout the user after fifteen minutes without activity", async () => {
    walletStore.abortSync();
    vi.useFakeTimers();

    try {
      render(Layout);

      await vi.advanceTimersByTimeAsync(navigation.INACTIVITY_TIMEOUT);

      expect(logoutSpy).toHaveBeenCalledTimes(1);
      expect(logoutSpy).toHaveBeenCalledWith(false);
    } finally {
      walletStore.abortSync();
      vi.useRealTimers();
    }
  });
});
