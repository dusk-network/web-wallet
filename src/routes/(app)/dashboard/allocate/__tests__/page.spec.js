import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { cleanup, render } from "@testing-library/svelte";
import mockedShieldedStatusStore from "$lib/mocks/mockedShieldedStatusStore";
import { operationsStore } from "$lib/stores";
import Allocation from "../+page.svelte";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    shieldedStatusStore: mockedShieldedStatusStore,
  };
});

vi.useFakeTimers();

describe("Allocate", () => {
  afterEach(() => {
    cleanup();
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: true,
      isPaused: false,
    });
  });

  afterAll(() => {
    vi.doUnmock("$lib/stores");
  });

  it("should render the allocation page", async () => {
    const { container, getByRole } = render(Allocation);

    await vi.advanceTimersToNextTimerAsync();

    expect(
      getByRole("spinbutton", { name: "Public amount" })
    ).toBeInTheDocument();
    expect(
      getByRole("spinbutton", { name: "Shielded amount" })
    ).toBeInTheDocument();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should show a notice instead of the form while shielded transactions are paused", async () => {
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: true,
      isPaused: true,
    });

    const { getByRole, getByText, queryByRole } = render(Allocation);

    await vi.advanceTimersToNextTimerAsync();

    expect(
      getByText("Shielded transactions are paused on this network.")
    ).toBeInTheDocument();
    expect(
      queryByRole("spinbutton", { name: "Public amount" })
    ).not.toBeInTheDocument();
    expect(
      queryByRole("spinbutton", { name: "Shielded amount" })
    ).not.toBeInTheDocument();
    expect(getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard"
    );
  });

  it("should set the current operation to an empty string when destroyed", async () => {
    const { unmount } = render(Allocation);

    operationsStore.set({ currentOperation: "foo operation" });

    unmount();

    expect(get(operationsStore)).toStrictEqual({ currentOperation: "" });
  });
});
