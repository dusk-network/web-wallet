import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { settingsStore } from "$lib/stores";

import Setup from "../+page.svelte";

describe("Setup", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("should show the wallet's name, its ways in and its version, and no picture that could look broken", () => {
    const { container, getByRole } = render(Setup, {});

    expect(getByRole("heading", { level: 2 })).toHaveTextContent(
      "Dusk Web Wallet"
    );
    expect(container.querySelector("footer")).toHaveTextContent(
      "Web Wallet v0.1.5"
    );
    expect(container.querySelector("css-doodle, img, canvas")).toBeNull();
  });

  it("should offer a first-time visitor to create or restore a wallet, and nothing to unlock", () => {
    const { getByRole, queryByRole } = render(Setup, {});

    expect(getByRole("link", { name: "Create new wallet" })).toHaveClass(
      "dusk-anchor-button--variant--primary"
    );
    expect(getByRole("link", { name: "Restore wallet" })).toBeVisible();
    expect(queryByRole("link", { name: "Unlock" })).toBeNull();
  });

  it("should offer to unlock the wallet kept in this browser first, and a new one second", () => {
    settingsStore.update((settings) => ({ ...settings, userId: "some-id" }));

    const { getAllByRole, getByRole } = render(Setup, {});
    const unlock = getByRole("link", { name: "Unlock" });

    expect(unlock.getAttribute("href")).toMatch(/\/unlock$/);
    expect(getAllByRole("link")[0]).toBe(unlock);
    expect(unlock).toHaveClass("dusk-anchor-button--variant--primary");
    expect(getByRole("link", { name: "Create new wallet" })).toHaveClass(
      "dusk-anchor-button--variant--tertiary"
    );
  });
});
