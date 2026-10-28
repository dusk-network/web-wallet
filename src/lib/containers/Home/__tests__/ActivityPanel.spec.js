import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("should say once that times are local, over days in sentence case", () => {
    const { getByRole, getByText, queryByText } = render(ActivityPanel, {
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

    expect(getByText("Shown in your local time")).toBeInTheDocument();
    expect(queryByText(/Times in your local time/)).toBeNull();
    expect(getByRole("heading", { level: 3, name: "Today" })).toHaveTextContent(
      /^Today$/
    );
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

  it("should grey a withdrawal's amount until it arrives", () => {
    const bridge = "ab".repeat(32);

    vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", bridge);

    try {
      const { container } = render(ActivityPanel, {
        locale: "en",
        state: {
          complete: true,
          error: null,
          hasMore: false,
          loaded: true,
          rows: [
            {
              ...stake,
              amount: "0",
              bridge: {
                amount: "1008000000000",
                kind: "prove",
                withdrawal: "0001".padEnd(64, "0"),
              },
              contractId: bridge,
              deposit: undefined,
              fnName: "proveWithdrawalTransaction",
            },
          ],
          syncing: false,
        },
      });

      expect(container.querySelector(".activity-row__amount")).toHaveClass(
        "activity-row__amount--muted"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
