import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { GasSettings } from "..";
import { get } from "svelte/store";
import { gasPriceStore, networkStore, settingsStore } from "$lib/stores";
import { createCurrencyFormatter } from "$lib/dusk/currency";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

describe("GasSettings", () => {
  const settings = get(settingsStore);
  const duskFormatter = createCurrencyFormatter(settings.language, "DUSK", 9);
  const fee = settings.gasPrice * 100_000_000n;

  const baseProps = {
    fee: fee,
    formatter: duskFormatter,
    limit: 20000000n,
    limitLower: 10000000n,
    limitUpper: 1000000000n,
    price: 1n,
    priceLower: 1n,
  };

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it("renders the GasSettings component opened", async () => {
    const { getByRole } = render(GasSettings, baseOptions);

    const next = getByRole("button", { name: "Edit" });

    await fireEvent.click(next);
  });

  it("gives the most it can cost first, exactly and in DUSK, with what at most means, before the gas that makes it", async () => {
    const { container, getByRole, getByText, queryByText } = render(
      GasSettings,
      {
        ...baseOptions,
        props: { ...baseProps, fee: 2_151_569n },
      }
    );

    // Rounded up beside Edit, as everywhere.
    expect(getByText("0.0022")).toBeInTheDocument();
    expect(queryByText(/at most:/)).toBeNull();

    await fireEvent.click(getByRole("button", { name: "Edit" }));

    const line = /** @type {HTMLElement} */ (
      container.querySelector(".gas-settings__exact")
    );

    expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "0.002151569 DUSK at most: it pays only for the gas used, up to 20,000,000 gas at 1 LUX each."
    );
    // Before the gas fields.
    expect(
      line.compareDocumentPosition(getByRole("textbox", { name: "Gas limit" }))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("says the network is busy while it asks more than the price, the default stopped at its ceiling, until it's raised to what it asks", async () => {
    const BUSY =
      "The network is busy. You can raise the gas price for it to go out sooner.";
    const connect = vi.spyOn(networkStore, "connect");

    /** @param {bigint} median */
    const nodeAsks = async (median) => {
      connect.mockResolvedValue(
        /** @type {any} */ ({
          blocks: { gasPrice: Promise.resolve({ median }) },
        })
      );
      await gasPriceStore.refresh();
    };

    try {
      await nodeAsks(900n);

      // The default, five times the lowest: under what it asks.
      const busy = render(GasSettings, {
        ...baseOptions,
        props: { ...baseProps, price: get(gasPriceStore) },
      });

      expect(get(gasPriceStore)).toBe(5n);
      expect(busy.getByRole("status")).toHaveTextContent(BUSY);

      // Raised to what it asks: said no more.
      await busy.rerender({ ...baseProps, price: 900n });

      expect(busy.queryByText(BUSY)).toBeNull();
      cleanup();

      // Not busy: nothing said.
      await nodeAsks(2n);

      const calm = render(GasSettings, {
        ...baseOptions,
        props: { ...baseProps, price: get(gasPriceStore) },
      });

      expect(calm.queryByText(BUSY)).toBeNull();
    } finally {
      // The lowest again, as the other tests start from.
      await nodeAsks(1n);
      connect.mockRestore();
    }
  });

  it("opens when the limit is below its lower bound", () => {
    const { getAllByRole } = render(GasSettings, {
      ...baseOptions,
      props: { ...baseProps, limitLower: baseProps.limit + 1n },
    });

    expect(getAllByRole("textbox")).toHaveLength(2);
  });

  it('checks "gasSettings" event is dispatched on click with the correct event data', async () => {
    const eventHandler = vi.fn();
    const { getByRole, getAllByRole } = render(GasSettings, {
      ...baseOptions,
      events: { gasSettings: eventHandler },
    });
    const editButton = getByRole("button", { name: "Edit" });

    expect(() => getAllByRole("textbox")).toThrow();

    await fireEvent.click(editButton);

    // Gas controls fires the event on mount
    expect(eventHandler).toHaveBeenCalledTimes(1);

    const [priceInput, limitInput] = getAllByRole("textbox");

    await fireEvent.input(limitInput, {
      target: { value: baseProps.limitLower },
    });

    expect(eventHandler).toHaveBeenCalledTimes(2);
    expect(eventHandler.mock.lastCall?.[0].detail).toStrictEqual({
      limit: baseProps.limitLower,
      price: baseProps.price,
    });

    await fireEvent.input(priceInput, {
      target: { value: baseProps.price * 2n },
    });

    expect(eventHandler).toHaveBeenCalledTimes(3);
    expect(eventHandler.mock.lastCall?.[0].detail).toStrictEqual({
      limit: baseProps.limitLower,
      price: baseProps.price * 2n,
    });
  });
});
