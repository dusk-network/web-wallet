import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";

import MainLayout from "../+layout.svelte";

const mocks = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  mocks.page = writable({
    route: { id: "/(welcome)/unlock" },
    url: new URL("http://localhost/unlock"),
  });

  return { page: mocks.page };
});

describe("Main layout's landmarks", () => {
  afterEach(cleanup);

  it("should keep the element around a page as the wallet opens, so that the page it opens on is drawn once", async () => {
    const { container, queryByRole } = render(MainLayout);
    const around = container.querySelector(".app");

    mocks.page?.set({
      route: { id: "/(app)/dashboard/send" },
      url: new URL("http://localhost/dashboard/send"),
    });
    await tick();

    expect(container.querySelector(".app")).toBe(around);
    // Each shell gives its page its main content and heading.
    expect(queryByRole("main")).toBeNull();
    expect(queryByRole("heading")).toBeNull();
  });
});
