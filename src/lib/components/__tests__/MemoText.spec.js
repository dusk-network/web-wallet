import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { MemoText } from "..";

const NOTE = "It has hidden characters, shown here as codes.";

describe("MemoText", () => {
  afterEach(cleanup);

  it("shows plain text as it is, in its lines", () => {
    const { container, queryByText } = render(MemoText, {
      text: "Factura 33\nabril",
    });

    expect(container.querySelector(".memo-text")?.textContent).toBe(
      "Factura 33\nabril"
    );
    expect(queryByText(NOTE)).toBeNull();
  });

  it.each([
    ["a sign request's reversed digits", "pay \u202E0001\u202C DUSK"],
    ["a name that reads backwards", "\u202Egnp.exe claim your airdrop"],
    ["a character that shows as nothing", "pay\u200B me"],
  ])("makes %s visible, and says so", (_, text) => {
    const { container, getByText } = render(MemoText, { text });
    const shown = container.querySelector(".memo-text")?.textContent;

    expect(shown).toMatch(/\\u[0-9a-f]{4}/);
    // Nothing of it can reorder what follows.
    expect(shown).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B]/);
    expect(getByText(NOTE)).toBeInTheDocument();
  });
});
