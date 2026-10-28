import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { GasControls } from "..";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

/**
 * @param {HTMLElement} input
 * @param {*} value
 * @returns {Promise<boolean>}
 */
const fireInput = (input, value) =>
  fireEvent.input(input, { target: { value } });

/** @param {HTMLElement} element */
const asInput = (element) => /** @type {HTMLInputElement} */ (element);

describe("GasControls", () => {
  const baseProps = {
    limit: 20n,
    limitLower: 10n,
    limitUpper: 100n,
    price: 10n,
    priceLower: 1n,
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  const eventHandler = vi.fn();

  afterEach(() => {
    cleanup();
    eventHandler.mockClear();
  });

  it("should render the `GasControls` component", () => {
    const { container } = render(GasControls, baseOptions);
    expect(container).toMatchSnapshot();
  });

  it('should dispatch a "gasSettings" event when the price or the limit are changed', async () => {
    const { getByLabelText } = render(GasControls, {
      ...baseOptions,
      events: { gasSettings: eventHandler },
    });

    // one call happens on mount, not sure why
    expect(eventHandler).toHaveBeenCalledTimes(1);

    const priceInput = asInput(getByLabelText(/price/i));
    const limitInput = asInput(getByLabelText(/limit/i));

    await fireInput(priceInput, 15);

    expect(eventHandler).toHaveBeenCalledTimes(2);
    expect(eventHandler.mock.lastCall?.[0].detail).toStrictEqual({
      limit: baseProps.limit,
      price: 15n,
    });
    expect(BigInt(priceInput.value)).toBe(15n);

    await fireInput(limitInput, 25);

    expect(eventHandler).toHaveBeenCalledTimes(3);
    expect(eventHandler.mock.lastCall?.[0].detail).toStrictEqual({
      limit: 25n,
      price: 15n,
    });
    expect(BigInt(limitInput.value)).toBe(25n);
  });

  it("should name its inputs with their labels", () => {
    const { getByLabelText } = render(GasControls, baseOptions);

    expect(getByLabelText("Gas price (LUX)")).toHaveValue("10");
    expect(getByLabelText("Gas limit")).toHaveValue("20");
  });

  it("should warn under the minimum gas limit, and over the maximum, while it is typed", async () => {
    const { getByLabelText, getByText, queryByText } = render(
      GasControls,
      baseOptions
    );
    const limitInput = getByLabelText("Gas limit");

    expect(limitInput).toHaveAttribute("aria-invalid", "false");

    await fireInput(limitInput, 9);

    expect(getByText("The minimum is 10.")).toBeInTheDocument();
    expect(limitInput).toHaveAttribute("aria-invalid", "true");
    expect(limitInput).toHaveAccessibleDescription("The minimum is 10.");

    await fireInput(limitInput, 101);

    expect(queryByText("The minimum is 10.")).toBeNull();
    expect(limitInput).toHaveAccessibleDescription("The maximum is 100.");

    await fireInput(limitInput, 50);

    expect(limitInput).not.toHaveAccessibleDescription();
    expect(limitInput).toHaveAttribute("aria-invalid", "false");
  });

  it("should warn under the lowest gas price while it is typed", async () => {
    const { getByLabelText } = render(GasControls, baseOptions);
    const priceInput = getByLabelText("Gas price (LUX)");

    await fireInput(priceInput, 0);

    expect(priceInput).toHaveAccessibleDescription("The minimum is 1 LUX.");

    await fireInput(priceInput, 21);

    expect(priceInput).toHaveAccessibleDescription(
      "It can't be higher than the gas limit."
    );
  });
});
