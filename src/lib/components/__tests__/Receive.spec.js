import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { shortenAddress } from "$lib/dusk/string";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";

import { Receive } from "..";

vi.mock("$lib/dusk/components/Toast/store", () => ({
  toast: vi.fn(),
}));

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

import { toast } from "$lib/dusk/components/Toast/store";

describe("Receive", () => {
  const address =
    "2in5ncLyGWg1CaQnPgkyMRaxrEtMmTKZXBy6yZxBeg5BL7ifxf2ZwT1h4VPsJYe8BpPMWYsHmNJGrXhJ1fMMLNz";

  /**
   * The names of the buttons shown.
   *
   * @param {() => HTMLElement[]} getAllButtons
   */
  const getButtonNames = (getAllButtons) =>
    getAllButtons().map((button) => button.getAttribute("aria-label"));

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

  it("should show the address shortened on one line, in full on hover and for screen readers, and copy it in full", async () => {
    const { container, getByRole } = render(Receive, { address });
    const shown = getAsHTMLElement(container, ".receive__address");

    expect(getAsHTMLElement(shown, "[aria-hidden='true']").textContent).toBe(
      shortenAddress(address)
    );
    expect(getAsHTMLElement(shown, ".sr-only").textContent).toBe(address);
    expect(shown).toHaveAttribute("title", address);

    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      address
    );
    expect(toast).toHaveBeenCalledExactlyOnceWith(
      "success",
      "Address copied",
      expect.any(String)
    );
  });

  it.each([
    ["no name", () => ""],
    ["a lookup that finds none", () => Promise.resolve("")],
    ["a lookup that fails", () => Promise.reject(new Error("Lookup failed"))],
    ["a lookup still running", () => new Promise(() => {})],
  ])(
    "should show only the address to copy, with no name or note, for %s",
    async (_, getName) => {
      const { container, getAllByRole, queryByRole } = render(Receive, {
        address,
        name: getName(),
      });

      await settle();

      expect(container.querySelector(".receive__name")).toBeNull();
      expect(container.querySelector(".receive__note")).toBeNull();
      expect(queryByRole("button", { name: "About this name" })).toBeNull();
      expect(getButtonNames(() => getAllByRole("button"))).toStrictEqual([
        "Copy address",
      ]);
    }
  );

  it.each([
    ["given", () => "alice.dusk"],
    ["looked up", () => Promise.resolve("alice.dusk")],
  ])(
    "should show a name %s above the address, and copy the name and the full address from their own fields",
    async (_, getName) => {
      const { container, getAllByRole, getByRole } = render(Receive, {
        address,
        name: getName(),
      });

      await settle();

      const shownName = getAsHTMLElement(container, ".receive__name");

      expect(shownName.textContent).toBe("alice.dusk");
      expect(shownName).toHaveAttribute("title", "alice.dusk");
      expect(getButtonNames(() => getAllByRole("button"))).toStrictEqual([
        "About this name",
        "Copy name",
        "Copy address",
      ]);

      await fireEvent.click(getByRole("button", { name: "Copy name" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        "alice.dusk"
      );
      expect(toast).toHaveBeenLastCalledWith(
        "success",
        "Name copied",
        expect.any(String)
      );

      await fireEvent.click(getByRole("button", { name: "Copy address" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(address);
      expect(toast).toHaveBeenLastCalledWith(
        "success",
        "Address copied",
        expect.any(String)
      );
    }
  );

  it.each(
    /** @type {Array<["account" | "address", string]>} */ ([
      ["account", "People who send to alice.dusk reach this public account."],
      [
        "address",
        "People who pay alice.dusk choose public or shielded. Anyone can see this address belongs to alice.dusk.",
      ],
    ])
  )(
    "should show what the name reaches, for an address of type %s, only once its info button is pressed",
    async (addressType, note) => {
      const { container, getByRole } = render(Receive, {
        address,
        addressType,
        name: "alice.dusk",
      });
      const info = getByRole("button", { name: "About this name" });
      const shownNote = getAsHTMLElement(container, ".receive__note");

      expect(info.tagName).toBe("BUTTON");
      expect(info).toHaveAttribute("type", "button");
      expect(info).toHaveAttribute("aria-controls", shownNote.id);
      expect(info).toHaveAttribute("aria-expanded", "false");
      expect(shownNote).toHaveTextContent(note);
      expect(shownNote).not.toBeVisible();

      info.focus();

      expect(info).toHaveFocus();

      await fireEvent.click(info);

      expect(info).toHaveAttribute("aria-expanded", "true");
      expect(shownNote).toBeVisible();

      await fireEvent.click(info);

      expect(info).toHaveAttribute("aria-expanded", "false");
      expect(shownNote).not.toBeVisible();
    }
  );

  it.each([
    ["Copy address", "NotAllowedError", "Clipboard access denied"],
    ["Copy address", "Error", "Failed to copy address"],
    ["Copy name", "NotAllowedError", "Clipboard access denied"],
    ["Copy name", "Error", "Failed to copy name"],
  ])(
    "should say so, and not that it copied, when %s fails with a %s",
    async (buttonName, errorName, message) => {
      const error = new Error("Write failed");

      error.name = errorName;
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockRejectedValue(error) },
      });

      const { getByRole } = render(Receive, { address, name: "alice.dusk" });

      await fireEvent.click(getByRole("button", { name: buttonName }));

      expect(toast).toHaveBeenCalledExactlyOnceWith(
        "error",
        message,
        expect.any(String)
      );
    }
  );

  it.each([
    [600, 240],
    [200, 200],
  ])(
    "should show the QR code at most 240 pixels wide: in %d pixels of room, %d",
    async (room, shown) => {
      const { ResizeObserver } = globalThis;

      // Reports the room the figure has as soon as it is observed.
      globalThis.ResizeObserver = class {
        /** @param {ResizeObserverCallback} callback */
        constructor(callback) {
          this.callback = callback;
        }

        disconnect() {}

        observe() {
          this.callback(
            /** @type {ResizeObserverEntry[]} */ ([
              { contentRect: { width: room } },
            ]),
            /** @type {ResizeObserver} */ (/** @type {unknown} */ (this))
          );
        }

        unobserve() {}
      };

      try {
        const { container } = render(Receive, { address });

        await vi.waitFor(() =>
          expect(
            getAsHTMLElement(container, "img.receive__qr")
          ).toHaveAttribute("width", String(shown))
        );
        expect(getAsHTMLElement(container, "img.receive__qr")).toHaveAttribute(
          "height",
          String(shown)
        );
      } finally {
        globalThis.ResizeObserver = ResizeObserver;
      }
    }
  );

  it("should have no Copy button besides the fields' own, and a Back link unless it's hidden", async () => {
    const { container, getByRole, queryByRole, rerender } = render(Receive, {
      address,
      name: "alice.dusk",
    });

    expect(queryByRole("button", { name: /^copy$/i })).toBeNull();
    expect(getByRole("link", { name: "Back" })).toBeInTheDocument();

    await rerender({ hideBackButton: true });

    expect(queryByRole("link", { name: "Back" })).toBeNull();
    expect(container.querySelector(".receive__buttons")).toBeNull();
  });
});
