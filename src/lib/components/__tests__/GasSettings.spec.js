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

  it("gives the most it can cost first, rounded up, then exactly in DUSK with the gas that makes it", async () => {
    const { container, getByRole, getByText } = render(GasSettings, {
      ...baseOptions,
      props: { ...baseProps, fee: 2_151_569n },
    });

    // Rounded up beside Edit, as everywhere.
    expect(getByText("0.0022")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Edit" }));

    const exact = container.querySelector(".gas-settings__exact");

    expect(exact).toHaveTextContent("0.002151569 DUSK");
    expect(exact).toHaveTextContent("20,000,000");
    expect(exact).toHaveTextContent("1 LUX");
  });

  it("says the network is busy while it asks more than the price, the default stopped at its ceiling, until it's raised to what it asks", async () => {
    const connect = vi.spyOn(networkStore, "connect");

    /**
     * A block's worth waiting in the node's mempool, each at `median`.
     *
     * @param {bigint} median
     */
    const nodeAsks = async (median) => {
      connect.mockResolvedValue(
        /** @type {any} */ ({
          query: async () => ({
            mempoolTxs: Array.from({ length: 1_000 }, () => ({
              gasLimit: 2_500_000,
              gasPrice: String(median),
            })),
          }),
        }),
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
      expect(busy.getByRole("status")).toBeInTheDocument();

      // Raised to what it asks: said no more.
      await busy.rerender({ ...baseProps, price: 900n });

      expect(busy.queryByRole("status")).toBeNull();
      cleanup();

      // Not busy: nothing said.
      await nodeAsks(2n);

      const calm = render(GasSettings, {
        ...baseOptions,
        props: { ...baseProps, price: get(gasPriceStore) },
      });

      expect(calm.queryByRole("status")).toBeNull();
    } finally {
      // The lowest again, as the other tests start from.
      await nodeAsks(1n);
      connect.mockRestore();
    }
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
