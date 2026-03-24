import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { cleanup, render } from "@testing-library/svelte";
import { operationsStore } from "$lib/stores";
import Allocation from "../+page.svelte";

vi.useFakeTimers();

describe("Allocate", () => {
  afterEach(cleanup);

  it("should render the allocation page", async () => {
    const { container } = render(Allocation);

    await vi.advanceTimersToNextTimerAsync();

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should set the current operation to an empty string when destroyed", async () => {
    const { unmount } = render(Allocation);

    operationsStore.set({ currentOperation: "foo operation" });

    unmount();

    expect(get(operationsStore)).toStrictEqual({ currentOperation: "" });
  });
});
