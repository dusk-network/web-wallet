import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";

import { dayLabel, shortAddress, timeLabel } from "$lib/activity/present";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import CommandBar from "../CommandBar.svelte";

const ids = vi.hoisted(() => ({
  // When the deposit was made.
  at: Date.UTC(2026, 10, 3, 21, 16),
  // Testnet's DuskEVM bridge on Dusk.
  bridge: "2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d",
  deposit: "40c50a".padEnd(64, "1"),
  // A payment kept on this device, further back than History shows yet,
  // from an address no profile or contact here has.
  older: "01d".padEnd(64, "2"),
  stranger:
    "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um",
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: true, networkName: "testnet" }),
    },
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

// The history kept has a deposit to DuskEVM.
vi.mock("$lib/activity", async (importOriginal) => {
  const { readable } = await import("svelte/store");
  const { rowOf } = await import("$lib/activity/__tests__/fixtures/rows");
  const rows = [
    rowOf({
      amount: "100000000",
      bridge: {
        amount: "100000000",
        kind: "deposit",
        to: "0xB0E834d62CA3f5cF0F82619c8515c673818f8C6b",
      },
      contractId: ids.bridge,
      fnName: "depositETHToWithValue",
      hash: ids.deposit,
      kind: "contract_call",
      status: "executed",
      timestamp: ids.at,
    }),
  ];

  return {
    .../** @type {object} */ (await importOriginal()),
    // The page History shows,
    activityState: readable({ rows }),
    // and all this device keeps.
    keptActivity: readable([
      ...rows,
      rowOf({
        amount: "50000000",
        direction: "in",
        from: ids.stranger,
        hash: ids.older,
        memo: "Pour le marché, merci",
        status: "executed",
        timestamp: ids.at - 9 * 86_400_000,
      }),
    ]),
  };
});

describe("CommandBar, with a history", () => {
  afterEach(() => {
    cleanup();
    setNodeNetwork(null);
  });

  it("names a bridge transaction as History does, with when it was made under it and its hash at the end", async () => {
    setNodeNetwork(networks.testnet);

    const { getByRole } = render(CommandBar, { pages: [] });

    await fireEvent.input(getByRole("combobox"), {
      target: { value: "40c50a" },
    });

    const option = getByRole("option", { name: /^To DuskEVM/ });

    const when = `${dayLabel(ids.at, { locale: "en" })}, ${timeLabel(ids.at, "en")}`;

    expect(option).toHaveTextContent(`To DuskEVM ${when} 40c50a…111111`);
    expect(option).not.toHaveTextContent("Called");
    expect(option).not.toHaveTextContent("depositETHToWithValue");
    expect(option.querySelector(".command-bar__sub")).toHaveTextContent(when);
    expect(option.querySelector(".command-bar__detail--end")).toHaveTextContent(
      "40c50a…111111"
    );
  });

  // Amélie's: "Nothing on this device" for payments History had, further
  // back than it showed; and in the results, a stranger's memo lost the
  // mark History gives it.
  it("finds what this device keeps of the history, not only what History shows, a stranger's memo marked as History marks it", async () => {
    setNodeNetwork(networks.testnet);

    const { getAllByRole, getByRole } = render(CommandBar, { pages: [] });

    await fireEvent.input(getByRole("combobox"), {
      target: { value: "marché" },
    });

    const [option] = getAllByRole("option");

    expect(option).toHaveAttribute("id", `command-tx:${ids.older}`);
    expect(option.querySelector(".command-bar__memo")).toHaveTextContent(
      `From ${shortAddress(ids.stranger)} · not in your contacts “Pour le marché, merci”`
    );
  });
});
