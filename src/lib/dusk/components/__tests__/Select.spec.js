import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";

import { Select } from "..";

const stringOptions = ["one", "two", "three", "four"];

/** @type {GroupedSelectOptions} */
const groupedOptions = {
  "Group one": [
    { label: "one", value: "1" },
    { label: "two", value: "2" },
    { disabled: true, label: "three", value: "3" },
  ],
  "Group two": [
    { label: "four", value: "4" },
    { label: "five", value: "5" },
  ],
};

describe("Select", () => {
  const baseProps = {
    options: stringOptions,
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it("should accept a change event handler", async () => {
    const changeHandler = vi.fn();
    const props = {
      ...baseProps,
      "data-testid": "my-select",
      value: "two",
    };

    render(Select, {
      ...baseOptions,
      events: { change: changeHandler },
      props,
    });

    /** @type {HTMLSelectElement} */
    const select = screen.getByTestId("my-select");
    const target = select.querySelector("option[value='four']");

    await fireEvent.change(select, { target });

    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(changeHandler).toHaveBeenCalledWith(expect.any(Event));
    expect(select.value).toBe("four");
  });

  it("should list its options by label and value, a label left out being the value, and in groups", () => {
    const optionsOf = (/** @type {{ options: any }} */ props) => {
      cleanup();

      const { container } = render(Select, { ...baseOptions, props });

      return Array.from(container.querySelectorAll("option"), (option) => [
        option.textContent?.trim(),
        option.value,
      ]);
    };

    expect(optionsOf({ options: ["one"] })).toEqual([["one", "one"]]);
    expect(
      optionsOf({ options: [{ label: "one", value: "1" }, { value: "2" }] })
    ).toEqual([
      ["one", "1"],
      ["2", "2"],
    ]);
    expect(optionsOf({ options: [{ label: "", value: "1" }] })).toEqual([
      ["", "1"],
    ]);

    const { container } = render(Select, {
      ...baseOptions,
      props: { options: groupedOptions },
    });

    expect(
      Array.from(container.querySelectorAll("optgroup"), (group) => [
        group.label,
        group.querySelectorAll("option").length,
      ])
    ).toEqual([
      ["Group one", 3],
      ["Group two", 2],
    ]);
  });
});
