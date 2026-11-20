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
      expect.any(String),
    );

    // Shift+Enter copies the address it points to; Enter sends to it.
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(writeText).toHaveBeenCalledWith(ALICE);
    expect(mocks.goto).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: "Enter" });

    expect(result).toBeInTheDocument();
    expect(mocks.resolveDuskName).toHaveBeenCalledOnce();
    expect(mocks.goto).toHaveBeenCalledWith("/dashboard/send?to=alice.dusk", {
      replaceState: true,
    });
  });
});
