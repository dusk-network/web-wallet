import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import CommandBar from "../CommandBar.svelte";

const ids = vi.hoisted(() => ({
  // Testnet's DuskEVM bridge on Dusk.
  bridge: "2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d",
  deposit: "40c50a".padEnd(64, "1"),
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

// The history has a deposit to DuskEVM.
vi.mock("$lib/activity", async (importOriginal) => {
  const { readable } = await import("svelte/store");
  const { rowOf } = await import("$lib/activity/__tests__/fixtures/rows");

  return {
    .../** @type {object} */ (await importOriginal()),
    activityState: readable({
      rows: [
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
        }),
      ],
    }),
  };
});

describe("CommandBar, with a history", () => {
  afterEach(() => {
    cleanup();
    setNodeNetwork(null);
  });

  it("names a bridge transaction as History does, with its method under it and its hash at the end", async () => {
    setNodeNetwork(networks.testnet);

    const { getByRole } = render(CommandBar, { pages: [] });

    await fireEvent.input(getByRole("combobox"), {
      target: { value: "40c50a" },
    });

    const option = getByRole("option", { name: /^To DuskEVM/ });

    expect(option).toHaveTextContent(
      "To DuskEVM depositETHToWithValue 40c50a…111111"
    );
    expect(option).not.toHaveTextContent("Called");
    expect(option.querySelector(".command-bar__sub")).toHaveTextContent(
      "depositETHToWithValue"
    );
    expect(option.querySelector(".command-bar__detail--end")).toHaveTextContent(
      "40c50a…111111"
    );
  });
});
