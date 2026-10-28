import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/svelte";

import { renderWithSlots } from "$lib/dusk/test-helpers";

import { SectionHead } from "..";

describe("SectionHead", () => {
  afterEach(cleanup);

  it("puts a section's head between brackets that are drawn, not read", () => {
    const { getByRole } = renderWithSlots({ default: "Activity" })(
      SectionHead,
      { props: { id: "activity-title" } }
    );
    const head = /** @type {HTMLElement} */ (
      getByRole("heading", { level: 2, name: "Activity" })
    );
    const brackets = head.querySelectorAll(".section-head__bracket");

    expect(head).toHaveClass("section-head");
    expect(head).toHaveAttribute("id", "activity-title");
    expect(head).toHaveTextContent(/^\[Activity\]$/);
    expect(
      Array.from(brackets, (bracket) => bracket.textContent)
    ).toStrictEqual(["[", "]"]);

    for (const bracket of brackets) {
      expect(bracket).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("takes a level and a class of its own", () => {
    const { getByRole } = renderWithSlots({ default: "Stake" })(SectionHead, {
      props: { className: "staking__choose", level: 3 },
    });

    expect(getByRole("heading", { level: 3, name: "Stake" })).toHaveClass(
      "section-head",
      "staking__choose"
    );
  });
});
