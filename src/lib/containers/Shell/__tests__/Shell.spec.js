import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import Shell from "../Shell.svelte";

const mocks = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  network: null,
  startHistory: vi.fn(),
  url: new URL("http://localhost"),
}));

vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        readable({ url: mocks.url }).subscribe(run),
    },
  };
});

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  mocks.network = writable({ connected: true, networkName: "testnet" });

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      subscribe: mocks.network.subscribe,
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
    mocks.url = new URL("http://localhost");
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

  it("says at the top that test DUSK has no value, on a test network only", async () => {
    const { container, getByRole, queryByRole } = render(Shell);

    expect(getByRole("note")).toHaveTextContent(
      "Testnet · Test DUSK has no value"
    );
    // At the top, above the top bar.
    expect(
      container.querySelector(".shell__header > .testnet-strip + .top-bar")
    ).toBeInTheDocument();

    await act(() =>
      mocks.network?.set({ connected: true, networkName: "mainnet" })
    );

    expect(queryByRole("note")).toBeNull();

    await act(() =>
      mocks.network?.set({ connected: true, networkName: "testnet" })
    );
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

  it("keeps Staking marked in a staking flow, which has the phone's bottom for its buttons", () => {
    mocks.url = new URL("http://localhost/some-base-path/dashboard/stake");

    const overview = render(Shell);
    const staking = () =>
      overview.getAllByRole("link", { name: /^\s*staking\s*$/i })[0];

    expect(overview.container.querySelector(".shell")).not.toHaveClass(
      "shell--flow"
    );
    expect(staking()).toHaveAttribute("aria-current", "page");

    cleanup();
    mocks.url = new URL(
      "http://localhost/some-base-path/dashboard/stake?flow=native"
    );

    const flow = render(Shell);

    expect(flow.container.querySelector(".shell")).toHaveClass("shell--flow");
    expect(
      flow.getAllByRole("link", { name: /^\s*staking\s*$/i })[0]
    ).toHaveAttribute("aria-current", "page");
  });

  it("lets a keyboard skip to the page's content", () => {
    const { getByRole } = render(Shell);

    expect(getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#shell-main"
    );
  });
});
