import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import WelcomeLayout from "../+layout.svelte";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: false, networkName: "testnet" }),
      // Still connecting.
      connect: () => new Promise(() => {}),
    },
  };
});

describe("The welcome screens' layout", () => {
  afterEach(cleanup);

  afterAll(() => {
    vi.doUnmock("$lib/stores");
  });

  it("is the wallet's frame: its top bar and the test network's strip over a column, not a card with a logo", () => {
    const { container, getByRole, getByText } = render(WelcomeLayout);

    expect(container.querySelector(".welcome-shell .top-bar")).toBeTruthy();
    expect(getByRole("img", { name: "Dusk Wallet" })).toBeInTheDocument();
    expect(getByRole("note")).toHaveTextContent("Testnet");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".welcome-shell__content")).toContainElement(
      getByText("Connecting to the network")
    );
  });
});
