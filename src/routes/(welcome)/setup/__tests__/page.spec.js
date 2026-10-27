import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { settingsStore } from "$lib/stores";

import Setup from "../+page.svelte";

vi.mock("css-doodle", () => ({}));

describe("Setup", () => {
  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  afterAll(() => {
    vi.doUnmock("css-doodle");
  });

  it("should render the Setup page", () => {
    const { container } = render(Setup, {});

    expect(container.firstElementChild).toMatchSnapshot();
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
