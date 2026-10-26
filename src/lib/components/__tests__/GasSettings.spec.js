import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { GasSettings } from "..";
import { get } from "svelte/store";
import { settingsStore } from "$lib/stores";
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

  it("renders the GasSettings component closed", () => {
    const { container } = render(GasSettings, baseOptions);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("renders the GasSettings component opened", async () => {
    const { container, getByRole } = render(GasSettings, baseOptions);

    const next = getByRole("button", { name: "Edit" });

    await fireEvent.click(next);

    expect(container.firstElementChild).toMatchSnapshot();
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
