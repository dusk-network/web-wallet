import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { mdiCheck, mdiContentCopy } from "@mdi/js";

import { CopyButton } from "..";

vi.mock("$lib/dusk/components/Toast/store", () => ({ toast: vi.fn() }));

import { toast } from "$lib/dusk/components/Toast/store";

describe("CopyButton", () => {
  const value =
    "8dcf6f8a4b5f0a6e1d2c3b4a59687766554433221100ffeeddccbbaa993db55e";

  vi.useFakeTimers();

  /** @param {Error | null} [refusal] */
  const clipboardThat = (refusal = null) => {
    Object.assign(navigator, {
      clipboard: {
        writeText: refusal
          ? vi.fn().mockRejectedValue(refusal)
          : vi.fn().mockResolvedValue(undefined),
      },
    });
  };

  /** What screen readers hear, from the app's polite live region. */
  const heard = () =>
    document.querySelector("[aria-live='polite']")?.textContent ?? "";

  /** @param {HTMLElement} button */
  const iconOf = (button) => button.querySelector("path")?.getAttribute("d");

  afterEach(() => {
    cleanup();
    vi.mocked(toast).mockClear();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("should say Copied on the button for 1.5 s, where it was pressed, and in no toast", async () => {
    clipboardThat();

    const { getByRole } = render(CopyButton, {
      name: "transaction ID",
      text: "Copy",
      value,
    });
    const button = getByRole("button", { name: "Copy transaction ID" });

    expect(heard()).toBe("");
    expect(button).toHaveTextContent(/^Copy$/);

    await fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(50);

    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      value
    );
    expect(button).toHaveAccessibleName("Copied");
    expect(button).toHaveTextContent(/^Copied$/);
    expect(iconOf(button)).toBe(mdiCheck);
    expect(heard()).toBe("Copied");
    expect(toast).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1449);

    expect(button).toHaveAccessibleName("Copied");

    await vi.advanceTimersByTimeAsync(51);

    expect(button).toHaveAccessibleName("Copy transaction ID");
    expect(button).toHaveTextContent(/^Copy$/);
    expect(iconOf(button)).toBe(mdiContentCopy);
    expect(heard()).toBe("");
  });

  it("should name an icon alone Copied, once it copied", async () => {
    clipboardThat();

    const { getByRole } = render(CopyButton, { name: "address", value });
    const button = getByRole("button", { name: "Copy address" });

    expect(button).toHaveTextContent(/^\s*$/);

    await fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(50);

    expect(button).toHaveAccessibleName("Copied");
    expect(iconOf(button)).toBe(mdiCheck);
    expect(heard()).toBe("Copied");

    await vi.advanceTimersByTimeAsync(1500);
  });

  it.each([
    ["NotAllowedError", "Clipboard access denied"],
    ["Error", "Couldn't copy the address"],
  ])(
    "should say in a toast it couldn't copy, for a %s, and not that it copied",
    async (errorName, message) => {
      const refusal = new Error("Write failed");

      refusal.name = errorName;
      clipboardThat(refusal);

      const { getByRole } = render(CopyButton, {
        name: "address",
        text: "Copy",
        value,
      });
      const button = getByRole("button", { name: "Copy address" });

      await fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(50);

      expect(toast).toHaveBeenCalledExactlyOnceWith(
        "error",
        message,
        expect.any(String)
      );
      expect(button).toHaveAccessibleName("Copy address");
      expect(heard()).toBe("");
    }
  );

  it("should not say Copied for a value it didn't copy", async () => {
    clipboardThat();

    const { getByRole, rerender } = render(CopyButton, {
      name: "address",
      value,
    });

    await fireEvent.click(getByRole("button", { name: "Copy address" }));
    await vi.advanceTimersByTimeAsync(50);
    expect(getByRole("button", { name: "Copied" })).toBeInTheDocument();

    // Receive switched to the other address within the 1.5 s.
    await rerender({ name: "address", value: "another address" });
    expect(getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    expect(iconOf(getByRole("button"))).toBe(mdiContentCopy);
  });
});
