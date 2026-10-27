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
    expect(
      getByText(
        "Searches this wallet on this device. Press Enter to open a result or send to a person, Shift+Enter to copy an address, or Enter to look a .dusk name or transaction up on the network."
      )
    ).toBeInTheDocument();

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

    await fireEvent.keyDown(input, { key: "Enter" });

    expect(result).toBeInTheDocument();
    expect(mocks.resolveDuskName).toHaveBeenCalledOnce();
    expect(mocks.goto).toHaveBeenCalledWith("/dashboard/send?to=alice.dusk");
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
