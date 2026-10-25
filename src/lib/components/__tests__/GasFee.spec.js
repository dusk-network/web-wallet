import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { GasFee } from "..";
import { get } from "svelte/store";
import { settingsStore } from "$lib/stores";
import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";

describe("GasFee", () => {
  const settings = get(settingsStore);
  const duskFormatter = createCurrencyFormatter(settings.language, "DUSK", 9);
  const fee = settings.gasPrice * 100_000_000n;

  afterEach(cleanup);

  it("renders the GasFee component", () => {
    const baseProps = {
      fee: fee,
      formatter: duskFormatter,
    };
    const { container, getByText } = render(GasFee, baseProps);

    expect(getByText("Network fee (max)")).toBeInTheDocument();
    expect(container.querySelector(".gas-fee__amount-value")?.textContent).toBe(
      duskFormatter(luxToDusk(fee))
    );

    expect(container.firstElementChild).toMatchSnapshot();
  });
});
