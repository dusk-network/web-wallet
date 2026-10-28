import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import CommandBar from "../CommandBar.svelte";

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  resolveDuskName: vi.fn(),
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: true, networkName: "testnet" }),
    },
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {typeof import("$lib/dusk-domains")} */ (await importOriginal()),
  resolveDuskName: mocks.resolveDuskName,
}));

vi.mock("$lib/navigation", async (importOriginal) => ({
  .../** @type {typeof import("$lib/navigation")} */ (await importOriginal()),
  goto: mocks.goto,
}));

const writeText = vi.fn().mockResolvedValue(undefined);

Object.assign(navigator, { clipboard: { writeText } });

const ALICE =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

const pages = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/send", keywords: "pay", label: "Send" },
];

describe("CommandBar", () => {
  afterEach(() => {
    cleanup();
    mocks.goto.mockReset();
    mocks.resolveDuskName.mockReset();
    writeText.mockClear();
  });

  it("searches this device as it is typed into, and says what leaves it", async () => {
    const { getByRole, getByText } = render(CommandBar, { pages });
    const input = getByRole("combobox");

    await vi.waitFor(() => expect(input).toHaveFocus());
    await fireEvent.input(input, { target: { value: "pay" } });

    expect(getByRole("option", { name: "Send" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // The keys, in one short line.
    expect(getByText("Enter: open · Shift+Enter: copy")).toHaveClass(
      "command-bar__note"
    );

    await fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.goto).toHaveBeenCalledWith("/dashboard/send");
  });

  it("looks a .dusk name up on the network only on Enter, once", async () => {
    mocks.resolveDuskName.mockResolvedValue({
      account: ALICE,
      name: "alice.dusk",
    });

    const { findByRole, getByRole } = render(CommandBar, { pages });
    const input = getByRole("combobox");

    await fireEvent.input(input, { target: { value: "alice.dusk" } });

    expect(mocks.resolveDuskName).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: "Enter" });

    const result = await findByRole("option", { name: /Send to alice\.dusk/ });

    expect(mocks.resolveDuskName).toHaveBeenCalledOnce();
    expect(mocks.resolveDuskName).toHaveBeenCalledWith(
      "alice.dusk",
      "testnet",
      expect.any(String)
    );

    // Shift+Enter copies the address it points to; Enter sends to it.
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(writeText).toHaveBeenCalledWith(ALICE);
    expect(mocks.goto).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: "Enter" });

    expect(result).toBeInTheDocument();
    expect(mocks.resolveDuskName).toHaveBeenCalledOnce();
    expect(mocks.goto).toHaveBeenCalledWith("/dashboard/send?to=alice.dusk");
  });

  it("offers to look a name typed without .dusk up as its .dusk name, on Enter", async () => {
    mocks.resolveDuskName.mockResolvedValue({
      account: ALICE,
      name: "bakery.dusk",
    });

    const { findByRole, getByRole, getByText } = render(CommandBar, {
      pages,
    });
    const input = getByRole("combobox");

    await fireEvent.input(input, { target: { value: "bakery" } });

    expect(
      getByText(
        "Nothing on this device. Press Enter to look up bakery.dusk on the network."
      )
    ).toBeInTheDocument();
    expect(mocks.resolveDuskName).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await findByRole("option", { name: /Send to bakery\.dusk/ })
    ).toBeInTheDocument();
    expect(mocks.resolveDuskName).toHaveBeenCalledWith(
      "bakery.dusk",
      "testnet",
      expect.any(String)
    );
  });

  it("copies an address looked up on the network with Shift+Enter", async () => {
    const { findByRole, getByRole } = render(CommandBar, { pages });
    const input = getByRole("combobox");

    await fireEvent.input(input, { target: { value: ALICE } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await findByRole("option", { name: /Send to this address/ });
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(writeText).toHaveBeenCalledWith(ALICE);
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it("says a name isn't registered", async () => {
    mocks.resolveDuskName.mockResolvedValue({
      error: "not-registered",
      name: "alise.dusk",
    });

    const { findByText, getByRole } = render(CommandBar, { pages });
    const input = getByRole("combobox");

    await fireEvent.input(input, { target: { value: "alise.dusk" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await findByText("alise.dusk isn't registered.")
    ).toBeInTheDocument();
  });

  it("opens a block by its height in the network's explorer, at the hash the node gives for it", async () => {
    const { networks } = await import("@dusk-network/networks");
    const { setNodeNetwork } = await import("$lib/stores/nodeNetwork");
    const hash = "b1".repeat(32);
    const tab = { close: vi.fn(), location: { href: "" }, opener: {} };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(/** @type {any} */ (tab));
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ block: { header: { hash } } }))
      );

    setNodeNetwork(networks.testnet);

    try {
      const { getByRole } = render(CommandBar, { pages });
      const input = getByRole("combobox");

      await fireEvent.input(input, { target: { value: "4704959" } });
      await fireEvent.keyDown(input, { key: "Enter" });

      expect(
        getByRole("option", { name: /Open block 4,704,959 in the explorer/ })
      ).toBeInTheDocument();
      // The tab opens on the key press, so no popup blocker stops it.
      expect(open).toHaveBeenCalledWith("", "_blank");
      await vi.waitFor(() =>
        expect(tab.location.href).toBe(
          `https://apps.testnet.dusk.network/explorer/blocks/block?id=${hash}`
        )
      );
      expect(tab.opener).toBeNull();
      expect(String(fetch.mock.calls[0][1]?.body)).toBe(
        "query { block(height: 4704959) { header { hash } } }"
      );
    } finally {
      open.mockRestore();
      fetch.mockRestore();
      setNodeNetwork(null);
    }
  });

  it("keeps the focus in the search with Tab, between the input and its close button", async () => {
    const close = vi.fn();
    const { getByRole } = render(CommandBar, {
      events: { close },
      props: { pages },
    });
    const input = getByRole("combobox");
    const closeButton = getByRole("button", { name: "Close search" });

    await vi.waitFor(() => expect(input).toHaveFocus());
    await fireEvent.keyDown(input, { key: "Tab" });

    expect(closeButton).toHaveFocus();

    await fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });

    expect(input).toHaveFocus();

    await fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

    expect(closeButton).toHaveFocus();

    await fireEvent.keyDown(closeButton, { key: "Escape" });

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const close = vi.fn();
    const { getByRole } = render(CommandBar, {
      events: { close },
      props: { pages },
    });

    await fireEvent.keyDown(getByRole("combobox"), { key: "Escape" });

    expect(close).toHaveBeenCalledOnce();
  });
});
