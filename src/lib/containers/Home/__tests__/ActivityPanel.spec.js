import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { nameFacts } from "$lib/activity/activityHistory";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import ActivityPanel from "../ActivityPanel.svelte";

vi.mock("$lib/bridge/withdrawalClaims", () => {
  // When the chain says the proved withdrawal can be claimed: Mon 2 Nov 2026, 03:20:39 UTC.
  const claims = new Map([
    [
      `0x${"8e".repeat(32)}`,
      {
        at: Date.UTC(2026, 10, 2, 3, 20, 39),
        claimed: false,
        exact: false,
        overdue: false,
        ready: false,
      },
    ],
  ]);

  return {
    default: {
      load: () => Promise.resolve(),
      /** @param {(value: Map<string, unknown>) => void} run */
      subscribe(run) {
        run(claims);

        return () => {};
      },
    },
  };
});

// A pool only Sozu's hub names.
const POOL = "5a".repeat(32);

const stake = {
  amount: "500000000",
  blockHeight: 4_687_000,
  contractId: POOL,
  fnName: "sozu_stake",
  hash: "ab".repeat(32),
  kind: "contract_call",
  status: "executed",
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
        rows: [rowOf(stake)],
        syncing: false,
      },
    });

    expect(getByText("Shown in your local time")).toBeInTheDocument();
    expect(queryByText(/Times in your local time/)).toBeNull();
    expect(getByRole("heading", { level: 3, name: "Today" })).toHaveTextContent(
      /^Today$/
    );
  });

  it("should name a call to Dusk Domains by what it did, on the node's network", () => {
    setNodeNetwork(networks.testnet);

    const { container } = render(ActivityPanel, {
      locale: "en",
      state: {
        complete: true,
        error: null,
        hasMore: false,
        loaded: true,
        rows: [
          rowOf(
            {
              ...stake,
              contractId:
                "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199",
              fnName: "register",
              registeredName: "alice.dusk",
            },
            { nameCall: nameFacts }
          ),
        ],
        syncing: false,
      },
    });

    expect(container).toHaveTextContent("Registered alice.dusk");
    setNodeNetwork(null);
  });

  it("should grey a withdrawal's amount until it arrives", () => {
    const { container } = render(ActivityPanel, {
      locale: "en",
      state: {
        complete: true,
        error: null,
        hasMore: false,
        loaded: true,
        rows: [
          rowOf({
            ...stake,
            amount: "0",
            bridge: {
              amount: "1008000000000",
              hash: `0x${"8e".repeat(32)}`,
              kind: "prove",
              withdrawal: "0001".padEnd(64, "0"),
            },
            contractId: "ab".repeat(32),
            fnName: "proveWithdrawalTransaction",
          }),
        ],
        syncing: false,
      },
    });

    expect(container.querySelector(".activity-row__amount")).toHaveClass(
      "activity-row__amount--muted"
    );

    // Its claim date on a line of its own, under the type, time and privacy.
    const lines = Array.from(
      container.querySelectorAll(".activity-row__line"),
      (line) => line.textContent?.trim()
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Bridge · .+ · Public$/);
    expect(lines[0]).not.toContain("claim");
    expect(lines[1]).toMatch(/^Claim from about /);
  });
});
