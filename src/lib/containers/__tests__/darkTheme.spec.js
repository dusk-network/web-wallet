import { describe, expect, it } from "vitest";

import styleRules from "$lib/dusk/test-helpers/styleRules";

/**
 * The custom properties a style sheet's rule sets.
 *
 * @param {string} file From this folder
 * @param {string} selector
 */
const tokens = (file, selector) =>
  Object.keys(
    styleRules(file, import.meta.url).find(
      (rule) => rule.selector === selector && rule.media === ""
    )?.declarations ?? {}
  ).filter((name) => name.startsWith("--"));

const BRIDGE = "../../../style/duskit-bridge.css";
const DUSKIT = "../../../../node_modules/@duskit/css/src/1-theme/theme.css";

describe("The dark theme", () => {
  it("keeps the calm look: what the bridge maps onto it, and Duskit's dark theme sets again, it sets again in dark", () => {
    const mapped = tokens(BRIDGE, ":root");
    const darkOnDuskit = tokens(DUSKIT, ":root.dark");
    const darkOnBridge = tokens(BRIDGE, ":root.dark");

    const overridden = mapped.filter((name) => darkOnDuskit.includes(name));

    expect(overridden).toEqual(
      expect.arrayContaining(["--page-background-color", "--surface-color"])
    );

    for (const name of overridden) {
      expect(darkOnBridge, name).toContain(name);
    }
  });

  it("puts the page, cards and text on the calm surfaces and text", () => {
    const dark =
      styleRules(BRIDGE, import.meta.url).find(
        (rule) => rule.selector === ":root.dark"
      )?.declarations ?? {};

    expect({
      "--background-color": dark["--background-color"],
      "--on-background-color": dark["--on-background-color"],
      "--on-surface-color": dark["--on-surface-color"],
      "--page-background-color": dark["--page-background-color"],
      "--surface-color": dark["--surface-color"],
    }).toStrictEqual({
      "--background-color": "var(--calm-s0)",
      "--on-background-color": "var(--calm-text)",
      "--on-surface-color": "var(--calm-text)",
      "--page-background-color": "var(--calm-s0)",
      "--surface-color": "var(--calm-s1)",
    });
  });
});
