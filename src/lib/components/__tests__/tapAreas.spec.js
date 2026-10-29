import { describe, expect, it } from "vitest";

import styleRules from "$lib/dusk/test-helpers/styleRules";

/** A phone's widths, as the wallet's phone layout takes them. */
const PHONES = "(max-width: 47.99rem)";

/**
 * @param {string} file
 * @param {string} selector
 */
const onPhones = (file, selector) =>
  styleRules(file, import.meta.url).find(
    (rule) => rule.media === PHONES && rule.selector === selector
  )?.declarations;

describe("tap areas on phones", () => {
  it("gives the Bridge card's Max 44 px, keeping its pill and its row as they are", () => {
    expect(
      onPhones("../SwapCard/SwapCard.svelte", ".swap-card :global(.swap-mini)")
    ).toStrictEqual({
      "background-clip": "padding-box",
      "border-block": "8px solid transparent",
      "box-sizing": "border-box",
      "margin-block": "-8px",
      "min-height": "44px",
    });
  });

  it("gives the eye by the total balance 44 px across, where it is", () => {
    expect(
      onPhones(
        "../../containers/Home/HomeBalance.svelte",
        ".home-balance__toggle"
      )
    ).toStrictEqual({
      height: "44px",
      margin: "-6px",
      position: "relative",
      width: "44px",
      "z-index": "1",
    });
  });
});
