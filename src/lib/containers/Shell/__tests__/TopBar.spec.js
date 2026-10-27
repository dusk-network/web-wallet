import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import TopBar from "../TopBar.svelte";
import { shellTabs } from "../navigation";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: true, networkName: "devnet" }),
    },
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

describe("TopBar", () => {
  const tabs = shellTabs({ stake: true });

  afterEach(cleanup);

  it("links the wallet's pages, the current one marked, and its settings", () => {
    const { getByRole } = render(TopBar, {
      activeTab: "history",
      settingsOpen: false,
      tabs,
    });

    expect(getByRole("link", { name: "Dusk Wallet, home" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard"
    );
    expect(getByRole("link", { name: "History" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/some-base-path/settings"
    );
  });

  it("shows the DUSK wordmark, a line and WALLET, named for screen readers", () => {
    const { getByRole } = render(TopBar, { activeTab: "home", tabs });
    const brand = getByRole("link", { name: "Dusk Wallet, home" });

    expect(brand.querySelector("svg.dusk-wordmark")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(brand.querySelector(".top-bar__divider")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(brand).toHaveTextContent(/^Wallet$/);
  });

  it("opens the search", async () => {
    const search = vi.fn();
    const { getByRole } = render(TopBar, {
      events: { search },
      props: { activeTab: "home", tabs },
    });

    await fireEvent.click(
      getByRole("button", { name: "Search names, addresses and transactions" })
    );

    expect(search).toHaveBeenCalledOnce();
  });

  it("shows the profile as a pill, and looks no .dusk names up on a network without them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container, getByRole } = render(TopBar, {
      activeTab: "home",
      tabs,
    });

    expect(container.querySelector(".address-picker--compact")).toBeTruthy();
    expect(
      container.querySelector(".address-picker__compact-name")
    ).toHaveTextContent("Profile 1");

    await fireEvent.click(
      getByRole("button", { name: "Select address profile" })
    );
    await new Promise((resolve) => setTimeout(resolve));

    expect(container.querySelector(".address-picker__address-name")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
