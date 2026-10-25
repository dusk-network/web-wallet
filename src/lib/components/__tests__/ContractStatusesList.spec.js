import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { settingsStore } from "$lib/stores";

import { ContractStatusesList } from "..";

describe("ContractStatusesList", () => {
  const baseProps = {
    statuses: [
      {
        label: "Spendable",
        value: "99,899.999724165",
      },
      {
        label: "Total Locked",
        value: "1,000.000000000",
      },
      {
        label: "Rewards",
        value: "99,288.000000000",
      },
    ],
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("should render the `ContractStatusesList` component", () => {
    const { container } = render(ContractStatusesList, baseOptions);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should be able to render the component without items", () => {
    const props = {
      ...baseProps,
      statuses: [],
    };
    const { container } = render(ContractStatusesList, {
      ...baseOptions,
      props,
    });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should show the values as dots, read as hidden, while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(ContractStatusesList, baseOptions);

    expect(
      Array.from(
        container.querySelectorAll(".contract-statuses__value"),
        (value) => value.textContent?.trim()
      )
    ).toStrictEqual(Array(3).fill("•••• hidden"));
    expect(
      Array.from(
        container.querySelectorAll(".contract-statuses__label"),
        (label) => label.textContent?.trim()
      )
    ).toStrictEqual(["Spendable", "Total Locked", "Rewards"]);
  });
});
