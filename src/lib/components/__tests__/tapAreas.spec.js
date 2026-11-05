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
    (rule) =>
      rule.media === PHONES && rule.selector.replace(/\s+/g, " ") === selector
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
});
