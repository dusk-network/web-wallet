import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { walletStore } from "$lib/stores";

import * as navigation from "..";

vi.mock("$lib/stores/walletStore");

describe("logout", () => {
  const gotoSpy = vi.spyOn(navigation, "goto");

  afterEach(() => {
    gotoSpy.mockClear();
    vi.mocked(walletStore.reset).mockClear();
  });

  afterAll(() => {
    gotoSpy.mockRestore();
    vi.doUnmock("$lib/stores/walletStore");
  });

  it("should reset the wallet store and redirect the user to the homepage, if the logout is not forced", async () => {
    await navigation.logout(false);

    expect(walletStore.reset).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/");
  });

  it("should go straight to the unlock after the wallet locked itself, with how long it was left alone", async () => {
    await navigation.logout(false, 5 * 60_000);

    expect(walletStore.reset).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledExactlyOnceWith("/unlock", {
      state: { lockedAfter: 5 },
    });
  });

  it("should redirect to `/forced-logout` if the logout is forced", async () => {
    await navigation.logout(true);

    expect(walletStore.reset).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy).toHaveBeenCalledWith("/forced-logout");
  });

  describe("the page it leaves", () => {
    afterEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it("should keep it for the next unlock, with what its query says", async () => {
      window.history.replaceState(
        null,
        "",
        "/some-base-path/dashboard/stake/?flow=liquid&action=unstake"
      );

      await navigation.logout(false);

      expect(navigation.takePlace()).toBe(
        "/dashboard/stake/?flow=liquid&action=unstake"
      );
    });

    it("should keep none that shows without a wallet, nor take the one kept for it", async () => {
      navigation.keepPlace({ pathname: "/dashboard/send/", search: "" });
      window.history.replaceState(null, "", "/some-base-path/setup/");

      await navigation.logout(false);

      expect(navigation.takePlace()).toBe("/dashboard/send/");
    });

    it("should forget where it was once forced out, as another wallet takes this one's place", async () => {
      window.history.replaceState(null, "", "/some-base-path/dashboard/send/");
      navigation.keepPlace({ pathname: "/dashboard/send/", search: "" });

      await navigation.logout(true);

      expect(navigation.takePlace()).toBeNull();
    });
  });
});
