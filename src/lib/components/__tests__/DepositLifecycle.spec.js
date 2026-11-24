import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/svelte";

import { settingsStore } from "$lib/stores";

import DepositLifecycle from "../EvmTransactions/DepositLifecycle.svelte";

vi.mock("$lib/web3/walletConnection", () => ({
  duskEvm: {
    blockExplorers: {
      default: { name: "Blockscout", url: "https://explorer.example.test" },
    },
  },
}));

// The history, with the deposit's Dusk transaction once it's read.
const history = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  state: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  const { derived, writable } = await import("svelte/store");

  history.state = writable({ rows: [] });

  return {
    .../** @type {object} */ (await importOriginal()),
    activityState: history.state,
    wholeActivity: derived(history.state, ({ rows }) => ({
      failed: false,
      reading: false,
      rows,
      whole: true,
    })),
  };
});

vi.mock("$lib/bridge/bridgeTimes", () => ({
  default: {
    load: () => Promise.resolve(),
    /** @param {(value: any) => void} run */
    subscribe(run) {
      run({ chain: null, network: "testnet" });

      return () => {};
    },
  },
}));

/**
 * What the deposit's details give for the line `name` says: its `dd`, as
 * the line's `dt` names it.
 *
 * @param {HTMLElement} container
 * @param {RegExp} name
 */
const detail = (container, name) =>
  Array.from(container.querySelectorAll(".deposit-status__details dt"))
    .find((term) => name.test(term.textContent ?? ""))
    ?.nextElementSibling?.textContent?.replace(/\s+/g, " ")
    .trim();

/** A deposit on its way to DuskEVM. */
const deposit = () => ({
  account: null,
  amountWei: "250000000000000000",
  createdAt: Date.now() - 60_000,
  failureLayer: null,
  l1BlockHeight: 4_708_700,
  l1ConfirmedAt: Date.now() - 30_000,
  progressedAt: Date.now(),
  stage: "l2_pending",
  transactionHash: "ab".repeat(32),
});

describe("DepositLifecycle", () => {
  afterEach(cleanup);

  it("should head a deposit's steps with its amount, as the Bridge shows it once sent", () => {
    const { getByRole } = render(DepositLifecycle, {
      deposit: deposit(),
    });

    expect(getByRole("heading", { name: "0.25 DUSK" })).toBeInTheDocument();
  });

  it("should say the network fee its Dusk transaction paid once the history has it", async () => {
    const { container } = render(DepositLifecycle, {
      deposit: { ...deposit(), stage: "completed" },
    });

    // None made up before.
    expect(detail(container, /^Fee$/)).toBeUndefined();

    await act(() =>
      history.state?.set({
        rows: [{ fee: 1_987_516n, hash: "ab".repeat(32) }],
      }),
    );

    expect(detail(container, /^Fee$/)).toBe("0.001987516 DUSK");
  });

  it("should hide its fee while balances are hidden where it's browsed, in Transfers, and show it in the result of the deposit sent, a flow", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));
    await act(() =>
      history.state?.set({
        rows: [{ fee: 1_987_516n, hash: "ab".repeat(32) }],
      }),
    );

    try {
      const browsed = render(DepositLifecycle, {
        deposit: { ...deposit(), stage: "completed" },
      });

      expect(detail(browsed.container, /^Fee$/)).toMatch(/DUSK$/);
      expect(detail(browsed.container, /^Fee$/)).not.toMatch(/\d/);
      cleanup();

      const sent = render(DepositLifecycle, {
        deposit: { ...deposit(), stage: "completed" },
        hidden: false,
      });

      expect(detail(sent.container, /^Fee$/)).toBe("0.001987516 DUSK");
    } finally {
      settingsStore.reset();
      history.state?.set({ rows: [] });
    }
  });
});
