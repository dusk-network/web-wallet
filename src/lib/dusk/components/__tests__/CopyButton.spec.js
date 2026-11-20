import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { CopyButton } from "..";

describe("CopyButton", () => {
  const value =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";

  vi.useFakeTimers();

  afterEach(cleanup);

  afterAll(() => {
    vi.useRealTimers();
  });

  /** @param {HTMLElement} button */
  const nameOf = (button) => button.getAttribute("aria-label");

  it("should copy exactly the value it's given", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const { getByRole } = render(CopyButton, { name: "address", value });

    await fireEvent.click(getByRole("button"));
    await vi.advanceTimersByTimeAsync(50);

    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      value,
    );
  });

  it("should not say it copied a value it didn't copy", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const { getByRole, rerender } = render(CopyButton, {
      name: "address",
      value,
    });
    const idle = nameOf(getByRole("button"));

    await fireEvent.click(getByRole("button"));
    await vi.advanceTimersByTimeAsync(50);

    // Said to have copied it, as the button's name goes.
    expect(nameOf(getByRole("button"))).toMatch(/copied/i);

    // Receive switched to the other address while it said it copied.
    await rerender({ name: "address", value: "another address" });

    expect(nameOf(getByRole("button"))).toBe(idle);
  });
});
