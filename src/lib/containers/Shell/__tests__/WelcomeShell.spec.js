import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, within } from "@testing-library/svelte";

import { renderWithSimpleContent } from "$lib/dusk/test-helpers";

import WelcomeShell from "../WelcomeShell.svelte";

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
  };
});

describe("WelcomeShell", () => {
  afterEach(cleanup);

  it("puts the screens before a wallet opens under the wallet's own top bar, with the brand alone, and the test network's strip", () => {
    const { container, getByRole } = renderWithSimpleContent(WelcomeShell, {});
    const header = /** @type {HTMLElement} */ (
      container.querySelector(".welcome-shell__header")
    );

    expect(within(header).getByRole("note")).toHaveTextContent(
      "Testnet · Test DUSK has no value"
    );
    expect(header.querySelector(".top-bar")).toBeInTheDocument();
    expect(getByRole("img", { name: "Dusk Wallet" })).toHaveClass(
      "top-bar__brand"
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector(".welcome-shell__content")
    ).toHaveTextContent("some text");
  });
});
