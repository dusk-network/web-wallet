import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import MainLayout from "../+layout.svelte";

const mocks = vi.hoisted(() => ({
  /** @type {string | null} */
  routeId: null,
  url: new URL("http://localhost/unlock"),
}));

vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        readable({ route: { id: mocks.routeId }, url: mocks.url }).subscribe(
          run
        ),
    },
  };
});

describe("Main layout's landmarks", () => {
  afterEach(() => {
    cleanup();
    mocks.routeId = null;
  });

  it("should give a page outside the wallet its main content and its heading", () => {
    mocks.routeId = "/(welcome)/unlock";

    const { getByRole } = render(MainLayout);

    expect(getByRole("main")).toHaveClass("app");
    expect(getByRole("heading", { level: 1 })).toHaveTextContent("Dusk Wallet");
  });

  it("should leave a wallet page's main content and heading to its shell, around its top bar and navigation", () => {
    mocks.routeId = "/(app)/dashboard/send";
    mocks.url = new URL("http://localhost/dashboard/send");

    const { container, queryByRole } = render(MainLayout);

    expect(queryByRole("main")).toBeNull();
    expect(queryByRole("heading")).toBeNull();
    expect(container.querySelector("div.app")).toBeTruthy();
  });
});
