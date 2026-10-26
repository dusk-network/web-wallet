import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { GasFee } from "..";
import { get } from "svelte/store";
import { settingsStore } from "$lib/stores";
import { formatFee } from "$lib/dusk/currency";

describe("GasFee", () => {
  const settings = get(settingsStore);
  const fee = settings.gasPrice * 100_000_000n;

  afterEach(cleanup);

  it("renders the GasFee component", () => {
    const baseProps = { fee };
    const { container, getByText } = render(GasFee, baseProps);

    expect(getByText("Network fee (at most)")).toBeInTheDocument();
    expect(container.querySelector(".gas-fee__amount-value")?.textContent).toBe(
      formatFee(fee, settings.language, { max: true })
    );
    expect(container.querySelector(".gas-fee__amount")).toHaveTextContent(
      "0.1 DUSK"
    );

    expect(container.firstElementChild).toMatchSnapshot();
  });
});
