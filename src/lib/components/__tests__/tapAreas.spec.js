import { describe, expect, it } from "vitest";

import styleRules from "$lib/dusk/test-helpers/styleRules";

/** A phone's widths, as the wallet's phone layout takes them. */
const PHONES = "(max-width: 47.99rem)";

/** Those, and a phone held sideways, which has a desktop's width. */
const THUMBS = `${PHONES}, (pointer: coarse)`;

/**
 * @param {string} file
 * @param {string} selector
 * @param {string} [media]
 */
const onPhones = (file, selector, media = PHONES) =>
  styleRules(file, import.meta.url).find(
    (rule) =>
      rule.media === media && rule.selector.replace(/\s+/g, " ") === selector
  )?.declarations;

describe("tap areas on phones", () => {
  it("gives the Bridge card's Max 44 px, keeping its pill and its row as they are", () => {
    expect(
      onPhones(
        "../SwapCard/SwapCard.svelte",
        ".swap-card :global(.swap-mini)",
        THUMBS
      )
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
        ".home-balance__toggle",
        THUMBS
      )
    ).toStrictEqual({
      height: "44px",
      margin: "-6px",
      position: "relative",
      width: "44px",
      "z-index": "1",
    });
  });

  it.each([
    [
      "../Send/Send.svelte",
      ".send--fee-short:not(.send--review) .send__summary > :global(.gas-settings)",
    ],
    [
      "../Stake/StakeFlow.svelte",
      ".stake-flow--fee-short:not(.stake-flow--review) .stake-flow__summary > :global(.gas-settings)",
    ],
  ])(
    "shows the fee's Edit with the form where the fee is what's short, in %s, as its summary waits for the review",
    (file, selector) => {
      expect(onPhones(file, selector)).toStrictEqual({ display: "block" });
    }
  );

  it("keeps them for a phone held sideways, which has a desktop's width", () => {
    const touch = styleRules(
      "../../../style/app-components/tap-targets.css",
      import.meta.url
    ).filter((rule) => rule.media.includes("(pointer: coarse)"));

    expect(touch.map(({ selector }) => selector)).toContain(
      ".dusk-icon-button::before,\n  .dusk-button--size--small::before,\n  .dusk-anchor-button--size--small::before,\n  .dusk-switch::before,\n  .swap-mini::before"
    );
    expect(
      styleRules("../../containers/Shell/TopBar.svelte", import.meta.url).find(
        ({ media }) => media === "(pointer: coarse)"
      )?.declarations
    ).toStrictEqual({ "min-height": "44px", "min-width": "44px" });
  });

  it.each([
    ["../Send/Send.svelte", ".send__contacts", "min-height"],
    [
      "../../containers/Shell/NetworkPill.svelte",
      ".network-pill__button",
      "height",
    ],
    [
      "../../containers/Home/ActivityPanel.svelte",
      ".activity-panel__filter",
      "height",
    ],
  ])(
    "gives %s's %s its 44 px by thumb, however it's held",
    (file, selector, side) => {
      const size = onPhones(file, selector, THUMBS)?.[side];

      expect(size === "44px" || size === "2.75rem").toBe(true);
    }
  );

  it("keeps History's kinds at a thumb's height, held sideways too", () => {
    expect(
      onPhones(
        "../../containers/History/HistoryView.svelte",
        ".history__kind",
        "(pointer: coarse)"
      )
    ).toStrictEqual({ height: "2.75rem" });
  });
});
