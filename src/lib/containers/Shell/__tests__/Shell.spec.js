import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import Shell from "../Shell.svelte";

const mocks = vi.hoisted(() => ({ startHistory: vi.fn() }));

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
    walletStore: {
      ...original.walletStore,
      ...mockedWalletStore,
      startHistory: mocks.startHistory,
    },
  };
});

describe("Shell", () => {
  afterEach(() => {
    cleanup();
    mocks.startHistory.mockClear();
  });

  it("opens the search with Ctrl K, and closes it with Escape", async () => {
    const { container, queryByRole } = render(Shell);

    expect(queryByRole("dialog", { name: "Search" })).toBeNull();

    await fireEvent.keyDown(window, { ctrlKey: true, key: "k" });

    expect(queryByRole("dialog", { name: "Search" })).toBeInTheDocument();

    await fireEvent.keyDown(
      /** @type {HTMLElement} */ (
        container.querySelector(".command-bar__input")
      ),
      { key: "Escape" }
    );

    expect(queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("keeps the current profile's history going", () => {
    render(Shell);

    expect(mocks.startHistory).toHaveBeenCalled();
  });

  it("hides the phone's tab bar while a field is typed in", async () => {
    const { container } = render(Shell);
    const shell = /** @type {HTMLElement} */ (
      container.querySelector(".shell")
    );
    const input = document.createElement("input");

    shell.append(input);
    await fireEvent.focusIn(input);

    expect(shell).toHaveClass("shell--typing");

    await fireEvent.focusOut(input);

    expect(shell).not.toHaveClass("shell--typing");
  });

  it("lets a keyboard skip to the page's content", () => {
    const { getByRole } = render(Shell);

    expect(getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#shell-main"
    );
  });
});
