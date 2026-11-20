import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { getAsHTMLElement } from "$lib/dusk/test-helpers";

import { Receive } from "..";

vi.mock("$lib/dusk/components/Toast/store", () => ({
  toast: vi.fn(),
}));

import { toast } from "$lib/dusk/components/Toast/store";

describe("Receive", () => {
  const address =
    "2in5ncLyGWg1CaQnPgkyMRaxrEtMmTKZXBy6yZxBeg5BL7ifxf2ZwT1h4VPsJYe8BpPMWYsHmNJGrXhJ1fMMLNz";

  /** Lets a name lookup settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.mocked(toast).mockClear();
  });

  it("should show the address in full, to read, and copy it", async () => {
    const { container, getByRole } = render(Receive, { address });

    expect(
      getAsHTMLElement(container, ".receive__full-address").textContent,
    ).toBe(address);

    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      address,
    );
  });

  it.each([
    ["given", () => "alice.dusk"],
    ["looked up", () => Promise.resolve("alice.dusk")],
  ])(
    "should show a name %s above the address, and copy the name and the full address from their own fields",
    async (_, getName) => {
      const { container, getByRole } = render(Receive, {
        address,
        name: getName(),
      });

      await settle();

      expect(getAsHTMLElement(container, ".receive__name").textContent).toBe(
        "alice.dusk",
      );

      await fireEvent.click(getByRole("button", { name: "Copy name" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        "alice.dusk",
      );

      await fireEvent.click(getByRole("button", { name: "Copy address" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(address);
    },
  );

  it.each([
    ["Copy address", "NotAllowedError"],
    ["Copy address", "Error"],
    ["Copy name", "NotAllowedError"],
    ["Copy name", "Error"],
  ])(
    "should say so, and not that it copied, when %s fails with a %s",
    async (buttonName, errorName) => {
      const error = new Error("Write failed");

      error.name = errorName;
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockRejectedValue(error) },
      });

      const { getByRole } = render(Receive, { address, name: "alice.dusk" });

      await fireEvent.click(getByRole("button", { name: buttonName }));

      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledExactlyOnceWith(
          "error",
          expect.any(String),
          expect.any(String),
        ),
      );
      expect(getByRole("button", { name: buttonName })).toBeInTheDocument();
    },
  );
});
