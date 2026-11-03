import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import styleRules from "$lib/dusk/test-helpers/styleRules";

import { Throbber } from "..";

/** The throbber's rules, and those for less motion. */
const rules = styleRules(
  "../../../../style/dusk-components/throbber.css",
  import.meta.url
).filter(({ selector }) => selector === ".dusk-throbber");

describe("Throbber", () => {
  const baseProps = {};
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it("should turn while something loads, and stand still where less motion is asked for", () => {
    const { container } = render(Throbber, baseOptions);

    // Not in SVG's own animation, which no media query can stop.
    expect(container.querySelector("animateTransform, animate")).toBeNull();
    expect(
      rules.find(({ media }) => media === "")?.declarations.animation
    ).toMatch(/linear\s+infinite$/);
    expect(
      rules.find(({ media }) => media === "(prefers-reduced-motion: reduce)")
        ?.declarations
    ).toStrictEqual({ animation: "none" });
  });
});
