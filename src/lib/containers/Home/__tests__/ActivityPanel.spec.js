import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { noteSozuPool } from "$lib/sozu";

import ActivityPanel from "../ActivityPanel.svelte";

// A pool only Sozu's hub names.
const POOL = "5a".repeat(32);

/** @type {ActivityRow} */
const stake = {
  amount: "500000000",
  blockHeight: 4_687_000,
  contractId: POOL,
  deposit: "500000000",
  direction: "out",
  fnName: "sozu_stake",
  hash: "ab".repeat(32),
  kind: "contract_call",
  privacy: "public",
  source: "archive",
  status: "executed",
  success: true,
  timestamp: Date.now() - 60_000,
};

describe("ActivityPanel", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("should read its rows again when Sozu's hub names another pool", async () => {
    const { container } = render(ActivityPanel, {
      locale: "en",
      state: {
        complete: true,
        error: null,
        hasMore: false,
        loaded: true,
        rows: [stake],
        syncing: false,
      },
    });

    expect(container).toHaveTextContent("Called sozu_stake");

    noteSozuPool(POOL);
    await tick();

    expect(container).toHaveTextContent("Staked with Sozu");
    expect(container).not.toHaveTextContent("Called sozu_stake");
  });
});
