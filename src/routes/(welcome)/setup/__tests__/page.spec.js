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

    expect(getByRole("link", { name: "Create new wallet" })).toBeVisible();
    expect(getByRole("link", { name: "Restore Wallet" })).toBeVisible();
    expect(queryByRole("link", { name: "Unlock Wallet" })).toBeNull();
  });

  it("should offer to unlock the wallet kept in this browser", () => {
    settingsStore.update((settings) => ({ ...settings, userId: "some-id" }));

    const { getByRole } = render(Setup, {});

    expect(
      getByRole("link", { name: "Unlock Wallet" }).getAttribute("href")
    ).toMatch(/\/unlock$/);
  });
});
