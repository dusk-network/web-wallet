import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import BridgeTimeline from "../EvmTransactions/BridgeTimeline.svelte";

describe("BridgeTimeline", () => {
  afterEach(cleanup);

  it("updates every marker when progress advances", async () => {
    const steps = ["Submitted", "Finalized", "Bridging", "Available"];
    const { container, rerender } = render(BridgeTimeline, {
      currentMessage: "Waiting for finality",
      progress: 1,
      steps,
    });

    expect(
      container.querySelectorAll(".bridge-timeline__step--complete")
    ).toHaveLength(1);
    expect(container.querySelector("[aria-current='step']")).toHaveTextContent(
      "Finalized"
    );

    await rerender({
      currentMessage: "Available on DuskEVM",
      progress: steps.length,
      steps,
    });

    expect(
      container.querySelectorAll(".bridge-timeline__step--complete")
    ).toHaveLength(steps.length);
    expect(container.querySelector("[aria-current='step']")).toBeNull();
  });
});
