import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/svelte";

import { renderWithSimpleContent } from "$lib/dusk/test-helpers";
import { networkStore } from "$lib/stores";

import WelcomeLayout from "../(welcome)/+layout.svelte";
import MaintenanceLayout from "../maintenance/+layout.svelte";
import ErrorPage from "../+error.svelte";

// The node named testnet the last time this browser reached it.
vi.hoisted(() => {
  localStorage.setItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-network`, "testnet");
});

// A page that isn't there.
vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");
  const page = readable({
    data: {},
    error: { message: "Not Found" },
    form: undefined,
    params: {},
    route: { id: null },
    status: 404,
    url: new URL("http://localhost/no-such-page/"),
  });
  const navigating = readable(null);
  const updated = { check: async () => false, ...readable(false) };

  return {
    getStores: () => ({ navigating, page, updated }),
    navigating,
    page,
    updated,
  };
});

/** @param {HTMLElement} container */
const stripOf = (container) => within(container).getByRole("note");

describe("The error pages", () => {
  afterEach(cleanup);

  afterAll(() => {
    localStorage.removeItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-network`);
  });

  it("keep the test network's strip when the network can't be reached, for the network the node named last here", async () => {
    const connect = vi
      .spyOn(networkStore, "connect")
      .mockRejectedValue(
        new Error("Timed out while connecting to the network")
      );
    const { container, findByText } = render(WelcomeLayout);

    expect(await findByText("Network connection issue")).toBeInTheDocument();
    expect(stripOf(container)).toHaveTextContent(
      "Testnet · Test DUSK has no value"
    );

    connect.mockRestore();
  });

  it("keep the strip on the maintenance page", () => {
    const { container } = renderWithSimpleContent(MaintenanceLayout, {});

    expect(stripOf(container)).toHaveTextContent(
      "Testnet · Test DUSK has no value"
    );
  });

  it("give a page that isn't there a way Home, under the strip", () => {
    const { container, getByRole } = render(ErrorPage);

    expect(getByRole("heading", { level: 2 })).toHaveTextContent("Error - 404");
    expect(getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/some-base-path/"
    );
    expect(stripOf(container)).toHaveTextContent(
      "Testnet · Test DUSK has no value"
    );
  });
});
