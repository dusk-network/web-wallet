import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import readStyleRules from "$lib/dusk/test-helpers/styleRules";

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

/** @param {string} file The component or its style sheet, from this folder */
const styleRules = (file) => readStyleRules(file, import.meta.url);

/** @param {string} media A query, as "(max-width: 23.37rem)" */
const maxWidthPx = (media) =>
  Number(/max-width: ([\d.]+)rem/.exec(media)?.[1] ?? 0) * 16;

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

  it("fits a 320 px phone: the round mark alone, and the network pill's dot, where the wordmark and the name don't fit", () => {
    const { getByRole } = render(TopBar, { activeTab: "home", tabs });
    const brand = getByRole("link", { name: "Dusk Wallet, home" });

    expect(brand.querySelector("svg.dusk-glyph")).toHaveAttribute(
      "aria-hidden",
      "true"
    );

    const bar = styleRules("../TopBar.svelte");
    const ruleOf = (/** @type {string} */ selector, media = "") =>
      bar.find((rule) => rule.selector === selector && rule.media === media);
    const narrow =
      bar.find(
        (rule) =>
          rule.selector === ".top-bar__brand :global(.dusk-wordmark)" &&
          rule.declarations.display === "none"
      )?.media ?? "";

    // The wordmark takes 370 px beside the phone's controls and the
    // network pill's longest label, Connecting: the round mark below that.
    expect(maxWidthPx(narrow)).toBeGreaterThanOrEqual(370.1);
    expect(
      ruleOf(".top-bar__brand :global(.dusk-glyph)")?.declarations.display
    ).toBe("none");
    expect(
      ruleOf(".top-bar__brand :global(.dusk-glyph)", narrow)?.declarations
        .display
    ).toBe("block");
    // Nothing shrinks under its content to make room.
    expect(
      bar.find((rule) => rule.selector === "& > :global(*)")?.declarations[
        "flex-shrink"
      ]
    ).toBe("0");

    // The round mark beside the pill takes 339 px: its dot alone below,
    // with the network's name still there for screen readers.
    const name = styleRules("../NetworkPill.svelte").find(
      (rule) => rule.selector === ".network-pill__name" && rule.media
    );

    expect(maxWidthPx(name?.media ?? "")).toBeGreaterThanOrEqual(339.2);
    expect(name?.declarations).toMatchObject({ position: "absolute" });
    expect(name?.declarations.display).toBeUndefined();
  });

  it("opens the network's and the profiles' popovers inside a phone's window, under the top bar", () => {
    const onPhones = (/** @type {string} */ media) =>
      maxWidthPx(media) >= 767.8;
    const pill = styleRules("../NetworkPill.svelte");
    const picker = styleRules(
      "../../../components/AddressPicker/AddressPicker.css"
    );
    const popovers = [
      [pill, ".network-pill__popover"],
      [picker, ".address-picker--compact .address-picker__drop-down"],
    ];

    for (const [rules, selector] of popovers) {
      const [always, phones] = ["", "phones"].map((media) =>
        /** @type {typeof pill} */ (rules).find(
          (rule) =>
            rule.selector === selector &&
            (media ? onPhones(rule.media) : !rule.media)
        )
      );

      // At most the window less 1 rem a side, 1 rem from its right edge.
      expect(always?.declarations.width).toMatch(
        /^min\(\d+rem, calc\(100vw - 2rem\)\)$/
      );
      expect(phones?.declarations).toMatchObject({
        position: "fixed",
        right: "1rem",
        top: "calc(var(--header-height, 3.75rem) + 0.5rem)",
      });
    }
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
